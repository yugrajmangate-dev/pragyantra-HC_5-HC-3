from __future__ import annotations

import csv
import io
import json
import os
from pathlib import Path
import re
import sqlite3
import threading
import time
from datetime import date, datetime, timedelta
from typing import Callable
import urllib.parse
import urllib.request
from zoneinfo import ZoneInfo
from zoneinfo import ZoneInfoNotFoundError
import httpx
import socket

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi import HTTPException
from fastapi import Query
from fastapi import Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ml_model import predict_outbreak

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://127.0.0.1:3000")
OPEN_METEO_GEOCODING_URL = os.getenv("OPEN_METEO_GEOCODING_URL", "https://geocoding-api.open-meteo.com/v1/search")
OPEN_METEO_FORECAST_URL = os.getenv("OPEN_METEO_FORECAST_URL", "https://api.open-meteo.com/v1/forecast")
DEFAULT_DATABASE_PATH = BASE_DIR / "outbreak_radar.db"
DATABASE_PATH = Path(os.getenv("OUTBREAK_DB_PATH", str(DEFAULT_DATABASE_PATH)))
if not DATABASE_PATH.is_absolute():
    DATABASE_PATH = (BASE_DIR / DATABASE_PATH).resolve()

WEATHER_CACHE_TTL_SECONDS = max(0, int(os.getenv("WEATHER_CACHE_TTL_SECONDS", "900")))
WEATHER_CACHE_MAX_ENTRIES = max(1, int(os.getenv("WEATHER_CACHE_MAX_ENTRIES", "512")))
HISTORY_MAX_PAGE_SIZE = max(1, int(os.getenv("HISTORY_MAX_PAGE_SIZE", "50")))
CSV_FILENAME_PREFIX = os.getenv("CSV_FILENAME_PREFIX", "alerts-history")
CSV_FILENAME_TIMEZONE = os.getenv("CSV_FILENAME_TIMEZONE", "UTC")
CURRENT_SCHEMA_VERSION = 4
ASSISTANT_PROVIDER = os.getenv("ASSISTANT_PROVIDER", "groq")
ASSISTANT_API_KEY = os.getenv("ASSISTANT_API_KEY")
ASSISTANT_OPENAI_MODEL = os.getenv("ASSISTANT_OPENAI_MODEL", "gpt-3.5-turbo")
ASSISTANT_GROQ_MODEL = os.getenv("ASSISTANT_GROQ_MODEL", "groq2-mini")
ALLOWED_STATUS_FILTERS = {"Safe", "Warning", "Critical Outbreak Risk"}
ALLOWED_SORT_ORDERS = {"newest", "oldest"}

app = FastAPI(title="Outbreak Radar API", version="0.1.0")

_db_lock = threading.Lock()
_weather_cache_lock = threading.Lock()
_weather_cache: dict[str, tuple[float, "WeatherSnapshot"]] = {}

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_ORIGIN, "http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class OutbreakInput(BaseModel):
    region_name: str = Field(..., min_length=2, max_length=100)
    rainfall_mm: float | None = Field(default=None, ge=0)
    temperature_c: float | None = Field(default=None, ge=-20, le=60)
    reported_fever_cases: int = Field(..., ge=0)


class GeoLocation(BaseModel):
    display_name: str
    latitude: float
    longitude: float


class WeatherSnapshot(BaseModel):
    temperature_c: float
    rainfall_mm: float


class HistoryRecord(BaseModel):
    prediction_id: int
    created_at: str
    region_name: str
    risk_score: int
    status: str
    rainfall_mm_used: float
    temperature_c_used: float
    weather_autofilled: bool
    confidence_lower: float
    confidence_upper: float


class HistoryQueryParts(BaseModel):
    where_sql: str
    args: list[str]


class ChatRequest(BaseModel):
    question: str = Field(..., min_length=1)


def _column_exists(connection: sqlite3.Connection, table_name: str, column_name: str) -> bool:
    columns = connection.execute(f"PRAGMA table_info({table_name})").fetchall()
    return any(str(column[1]) == column_name for column in columns)


def _migration_001_create_core_tables(connection: sqlite3.Connection) -> None:
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS geocoding_results (
            region_key TEXT PRIMARY KEY,
            query_region_name TEXT NOT NULL,
            resolved_region_name TEXT NOT NULL,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            provider TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS prediction_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            input_region_name TEXT NOT NULL,
            resolved_region_name TEXT NOT NULL,
            latitude REAL,
            longitude REAL,
            rainfall_mm_input REAL,
            temperature_c_input REAL,
            rainfall_mm_used REAL NOT NULL,
            temperature_c_used REAL NOT NULL,
            reported_fever_cases INTEGER NOT NULL,
            weather_autofilled INTEGER NOT NULL,
            risk_score INTEGER NOT NULL,
            status TEXT NOT NULL
        )
        """
    )


def _migration_002_add_prediction_indexes(connection: sqlite3.Connection) -> None:
    connection.execute("CREATE INDEX IF NOT EXISTS idx_prediction_results_created_at ON prediction_results(created_at)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_prediction_results_status ON prediction_results(status)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_geocoding_results_updated_at ON geocoding_results(updated_at)")


def _migration_003_add_confidence_columns(connection: sqlite3.Connection) -> None:
    if not _column_exists(connection, "prediction_results", "confidence_lower"):
        connection.execute("ALTER TABLE prediction_results ADD COLUMN confidence_lower REAL")

    if not _column_exists(connection, "prediction_results", "confidence_upper"):
        connection.execute("ALTER TABLE prediction_results ADD COLUMN confidence_upper REAL")

    connection.execute(
        """
        UPDATE prediction_results
        SET confidence_lower = CASE
            WHEN confidence_lower IS NULL THEN MAX(0, risk_score - 10)
            ELSE confidence_lower
        END,
            confidence_upper = CASE
            WHEN confidence_upper IS NULL THEN MIN(100, risk_score + 10)
            ELSE confidence_upper
        END
        """
    )


def _migration_004_add_analytics_tables(connection: sqlite3.Connection) -> None:
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS features_daily (
            date_key TEXT PRIMARY KEY,
            total_predictions INTEGER NOT NULL DEFAULT 0,
            avg_risk_score REAL NOT NULL DEFAULT 0,
            avg_rainfall_mm REAL NOT NULL DEFAULT 0,
            avg_temperature_c REAL NOT NULL DEFAULT 0,
            total_fever_cases INTEGER NOT NULL DEFAULT 0,
            safe_count INTEGER NOT NULL DEFAULT 0,
            warning_count INTEGER NOT NULL DEFAULT 0,
            critical_count INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS region_risk_trends (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            region_name TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            risk_score INTEGER NOT NULL,
            confidence_lower REAL NOT NULL,
            confidence_upper REAL NOT NULL,
            status TEXT NOT NULL
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS alerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            region_name TEXT NOT NULL,
            severity TEXT NOT NULL,
            risk_score INTEGER NOT NULL,
            confidence_lower REAL NOT NULL,
            confidence_upper REAL NOT NULL,
            reason TEXT NOT NULL,
            is_active INTEGER NOT NULL DEFAULT 1
        )
        """
    )
    connection.execute("CREATE INDEX IF NOT EXISTS idx_features_daily_date_key ON features_daily(date_key)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_region_risk_trends_region ON region_risk_trends(region_name)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_region_risk_trends_created_at ON region_risk_trends(created_at)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_alerts_created_at ON alerts(created_at)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_alerts_is_active ON alerts(is_active)")


MIGRATIONS: list[tuple[int, str, Callable[[sqlite3.Connection], None]]] = [
    (1, "create_core_tables", _migration_001_create_core_tables),
    (2, "add_prediction_indexes", _migration_002_add_prediction_indexes),
    (3, "add_prediction_confidence_columns", _migration_003_add_confidence_columns),
    (4, "add_analytics_tables", _migration_004_add_analytics_tables),
]


def run_database_migrations() -> None:
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DATABASE_PATH) as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )

        applied_versions = {
            int(row[0])
            for row in connection.execute("SELECT version FROM schema_migrations").fetchall()
        }

        for version, name, migration in MIGRATIONS:
            if version in applied_versions:
                continue

            migration(connection)
            connection.execute(
                "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
                (version, name),
            )

        connection.execute(f"PRAGMA user_version = {CURRENT_SCHEMA_VERSION}")
        connection.commit()


def _normalize_region_name(region_name: str) -> str:
    return region_name.strip().lower()


def _load_geocoding_result_from_db(region_name: str) -> GeoLocation | None:
    region_key = _normalize_region_name(region_name)
    with sqlite3.connect(DATABASE_PATH) as connection:
        row = connection.execute(
            """
            SELECT resolved_region_name, latitude, longitude
            FROM geocoding_results
            WHERE region_key = ?
            """,
            (region_key,),
        ).fetchone()

    if row is None:
        return None

    return GeoLocation(
        display_name=str(row[0]),
        latitude=float(row[1]),
        longitude=float(row[2]),
    )


def _save_geocoding_result_to_db(region_name: str, geolocation: GeoLocation) -> None:
    region_key = _normalize_region_name(region_name)
    with _db_lock:
        with sqlite3.connect(DATABASE_PATH) as connection:
            connection.execute(
                """
                INSERT INTO geocoding_results (
                    region_key,
                    query_region_name,
                    resolved_region_name,
                    latitude,
                    longitude,
                    provider,
                    updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(region_key) DO UPDATE SET
                    query_region_name = excluded.query_region_name,
                    resolved_region_name = excluded.resolved_region_name,
                    latitude = excluded.latitude,
                    longitude = excluded.longitude,
                    provider = excluded.provider,
                    updated_at = CURRENT_TIMESTAMP
                """,
                (
                    region_key,
                    region_name,
                    geolocation.display_name,
                    geolocation.latitude,
                    geolocation.longitude,
                    "open-meteo-geocoding",
                ),
            )
            connection.commit()


def _build_confidence_band(risk_score: int, reported_fever_cases: int, weather_autofilled: bool) -> tuple[float, float]:
    base_margin = 9.0
    severity_margin = min(10.0, reported_fever_cases / 25.0)
    autofill_margin = 2.5 if weather_autofilled else 0.0
    margin = base_margin + severity_margin + autofill_margin

    lower = max(0.0, float(risk_score) - margin)
    upper = min(100.0, float(risk_score) + margin)
    return round(lower, 1), round(upper, 1)


def _resolve_alert_severity(status: str) -> str | None:
    if status == "Critical Outbreak Risk":
        return "critical"
    if status == "Warning":
        return "warning"
    return None


def _update_daily_features(
    connection: sqlite3.Connection,
    created_at: str,
    rainfall_mm_used: float,
    temperature_c_used: float,
    reported_fever_cases: int,
    risk_score: int,
    status: str,
) -> None:
    date_key = created_at[:10]

    existing = connection.execute(
        """
        SELECT
            total_predictions,
            avg_risk_score,
            avg_rainfall_mm,
            avg_temperature_c,
            total_fever_cases,
            safe_count,
            warning_count,
            critical_count
        FROM features_daily
        WHERE date_key = ?
        """,
        (date_key,),
    ).fetchone()

    if existing is None:
        safe_count = 1 if status == "Safe" else 0
        warning_count = 1 if status == "Warning" else 0
        critical_count = 1 if status == "Critical Outbreak Risk" else 0
        connection.execute(
            """
            INSERT INTO features_daily (
                date_key,
                total_predictions,
                avg_risk_score,
                avg_rainfall_mm,
                avg_temperature_c,
                total_fever_cases,
                safe_count,
                warning_count,
                critical_count,
                updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            """,
            (
                date_key,
                1,
                float(risk_score),
                float(rainfall_mm_used),
                float(temperature_c_used),
                int(reported_fever_cases),
                safe_count,
                warning_count,
                critical_count,
            ),
        )
        return

    current_total = int(existing[0])
    next_total = current_total + 1
    current_avg_risk = float(existing[1])
    current_avg_rainfall = float(existing[2])
    current_avg_temperature = float(existing[3])
    current_fever_total = int(existing[4])
    current_safe = int(existing[5])
    current_warning = int(existing[6])
    current_critical = int(existing[7])

    next_avg_risk = ((current_avg_risk * current_total) + float(risk_score)) / next_total
    next_avg_rainfall = ((current_avg_rainfall * current_total) + float(rainfall_mm_used)) / next_total
    next_avg_temperature = ((current_avg_temperature * current_total) + float(temperature_c_used)) / next_total

    connection.execute(
        """
        UPDATE features_daily
        SET total_predictions = ?,
            avg_risk_score = ?,
            avg_rainfall_mm = ?,
            avg_temperature_c = ?,
            total_fever_cases = ?,
            safe_count = ?,
            warning_count = ?,
            critical_count = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE date_key = ?
        """,
        (
            next_total,
            next_avg_risk,
            next_avg_rainfall,
            next_avg_temperature,
            current_fever_total + int(reported_fever_cases),
            current_safe + (1 if status == "Safe" else 0),
            current_warning + (1 if status == "Warning" else 0),
            current_critical + (1 if status == "Critical Outbreak Risk" else 0),
            date_key,
        ),
    )


def _write_prediction_analytics(
    connection: sqlite3.Connection,
    created_at: str,
    resolved_region_name: str,
    rainfall_mm_used: float,
    temperature_c_used: float,
    reported_fever_cases: int,
    risk_score: int,
    status: str,
    confidence_lower: float,
    confidence_upper: float,
) -> None:
    _update_daily_features(
        connection=connection,
        created_at=created_at,
        rainfall_mm_used=rainfall_mm_used,
        temperature_c_used=temperature_c_used,
        reported_fever_cases=reported_fever_cases,
        risk_score=risk_score,
        status=status,
    )

    connection.execute(
        """
        INSERT INTO region_risk_trends (
            region_name,
            created_at,
            risk_score,
            confidence_lower,
            confidence_upper,
            status
        ) VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
            resolved_region_name,
            created_at,
            int(risk_score),
            float(confidence_lower),
            float(confidence_upper),
            status,
        ),
    )

    alert_severity = _resolve_alert_severity(status)
    if alert_severity is not None:
        connection.execute(
            """
            INSERT INTO alerts (
                created_at,
                region_name,
                severity,
                risk_score,
                confidence_lower,
                confidence_upper,
                reason,
                is_active
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
            """,
            (
                created_at,
                resolved_region_name,
                alert_severity,
                int(risk_score),
                float(confidence_lower),
                float(confidence_upper),
                f"{status} detected at {risk_score}/100 with confidence band {confidence_lower}-{confidence_upper}.",
            ),
        )


def _save_prediction_result(
    payload: OutbreakInput,
    resolved_region_name: str,
    latitude: float | None,
    longitude: float | None,
    rainfall_mm_used: float,
    temperature_c_used: float,
    weather_autofilled: bool,
    risk_score: int,
    status: str,
    confidence_lower: float,
    confidence_upper: float,
) -> tuple[int, str]:
    with _db_lock:
        with sqlite3.connect(DATABASE_PATH) as connection:
            cursor = connection.execute(
                """
                INSERT INTO prediction_results (
                    input_region_name,
                    resolved_region_name,
                    latitude,
                    longitude,
                    rainfall_mm_input,
                    temperature_c_input,
                    rainfall_mm_used,
                    temperature_c_used,
                    reported_fever_cases,
                    weather_autofilled,
                    risk_score,
                    status,
                    confidence_lower,
                    confidence_upper
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    payload.region_name,
                    resolved_region_name,
                    latitude,
                    longitude,
                    payload.rainfall_mm,
                    payload.temperature_c,
                    rainfall_mm_used,
                    temperature_c_used,
                    payload.reported_fever_cases,
                    int(weather_autofilled),
                    risk_score,
                    status,
                    confidence_lower,
                    confidence_upper,
                ),
            )
            prediction_id = int(cursor.lastrowid)

            created_at_row = connection.execute(
                "SELECT created_at FROM prediction_results WHERE id = ?",
                (prediction_id,),
            ).fetchone()
            created_at = str(created_at_row[0]) if created_at_row is not None else datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")

            _write_prediction_analytics(
                connection=connection,
                created_at=created_at,
                resolved_region_name=resolved_region_name,
                rainfall_mm_used=rainfall_mm_used,
                temperature_c_used=temperature_c_used,
                reported_fever_cases=payload.reported_fever_cases,
                risk_score=risk_score,
                status=status,
                confidence_lower=confidence_lower,
                confidence_upper=confidence_upper,
            )

            connection.commit()

    return prediction_id, created_at


def clear_weather_cache() -> None:
    with _weather_cache_lock:
        _weather_cache.clear()


def _weather_cache_key(latitude: float, longitude: float) -> str:
    return f"{round(latitude, 2):.2f}:{round(longitude, 2):.2f}"


def _load_weather_from_cache(latitude: float, longitude: float) -> WeatherSnapshot | None:
    if WEATHER_CACHE_TTL_SECONDS == 0:
        return None

    cache_key = _weather_cache_key(latitude, longitude)
    now = time.time()

    with _weather_cache_lock:
        entry = _weather_cache.get(cache_key)
        if entry is None:
            return None

        expires_at, snapshot = entry
        if expires_at <= now:
            _weather_cache.pop(cache_key, None)
            return None

        return snapshot


def _store_weather_in_cache(latitude: float, longitude: float, snapshot: WeatherSnapshot) -> None:
    if WEATHER_CACHE_TTL_SECONDS == 0:
        return

    cache_key = _weather_cache_key(latitude, longitude)
    expires_at = time.time() + WEATHER_CACHE_TTL_SECONDS

    with _weather_cache_lock:
        if len(_weather_cache) >= WEATHER_CACHE_MAX_ENTRIES:
            oldest_key = min(_weather_cache.items(), key=lambda item: item[1][0])[0]
            _weather_cache.pop(oldest_key, None)

        _weather_cache[cache_key] = (expires_at, snapshot)


def _parse_history_date(value: str, param_name: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=f"Invalid {param_name}. Use YYYY-MM-DD format.") from error


def _request_json(base_url: str, params: dict[str, str]) -> dict:
    query_string = urllib.parse.urlencode(params)
    request_url = f"{base_url}?{query_string}"
    request = urllib.request.Request(
        request_url,
        headers={
            "User-Agent": "outbreak-radar/1.0",
        },
    )

    with urllib.request.urlopen(request, timeout=10) as response:
        return json.loads(response.read().decode("utf-8"))


def _fetch_geocode_from_api(region_name: str) -> GeoLocation | None:
    geocode_response = _request_json(
        OPEN_METEO_GEOCODING_URL,
        {
            "name": region_name,
            "count": "1",
            "language": "en",
            "format": "json",
        },
    )

    results = geocode_response.get("results") or []
    if not results:
        return None

    first_result = results[0]
    location_name = str(first_result.get("name", region_name))
    admin1 = first_result.get("admin1")
    country = first_result.get("country")

    display_parts = [location_name]
    if admin1:
        display_parts.append(str(admin1))
    if country:
        display_parts.append(str(country))

    return GeoLocation(
        display_name=", ".join(display_parts),
        latitude=float(first_result["latitude"]),
        longitude=float(first_result["longitude"]),
    )


def geocode_region(region_name: str) -> GeoLocation | None:
    persisted_geocoding = _load_geocoding_result_from_db(region_name)
    if persisted_geocoding is not None:
        return persisted_geocoding

    fetched_geocoding = _fetch_geocode_from_api(region_name)
    if fetched_geocoding is not None:
        _save_geocoding_result_to_db(region_name, fetched_geocoding)

    return fetched_geocoding


def _fetch_current_weather_uncached(latitude: float, longitude: float) -> WeatherSnapshot:
    forecast_response = _request_json(
        OPEN_METEO_FORECAST_URL,
        {
            "latitude": str(latitude),
            "longitude": str(longitude),
            "current": "temperature_2m,precipitation",
        },
    )

    current = forecast_response.get("current")
    if not current:
        raise HTTPException(status_code=502, detail="Weather provider returned no current weather data")

    return WeatherSnapshot(
        temperature_c=float(current.get("temperature_2m", 0.0)),
        rainfall_mm=float(current.get("precipitation", 0.0)),
    )


def fetch_current_weather(latitude: float, longitude: float) -> WeatherSnapshot:
    cached_snapshot = _load_weather_from_cache(latitude, longitude)
    if cached_snapshot is not None:
        return cached_snapshot

    fetched_snapshot = _fetch_current_weather_uncached(latitude, longitude)
    _store_weather_in_cache(latitude, longitude, fetched_snapshot)
    return fetched_snapshot


def _build_history_query_parts(status: str | None, start_date: str | None, end_date: str | None) -> HistoryQueryParts:
    where_clauses: list[str] = []
    query_args: list[str] = []

    if status is not None:
        if status not in ALLOWED_STATUS_FILTERS:
            raise HTTPException(status_code=422, detail="Invalid status filter")
        where_clauses.append("status = ?")
        query_args.append(status)

    if start_date is not None:
        start_value = _parse_history_date(start_date, "start_date")
        where_clauses.append("created_at >= ?")
        query_args.append(f"{start_value.isoformat()} 00:00:00")

    if end_date is not None:
        end_value = _parse_history_date(end_date, "end_date")
        exclusive_end = end_value + timedelta(days=1)
        where_clauses.append("created_at < ?")
        query_args.append(f"{exclusive_end.isoformat()} 00:00:00")

    where_sql = ""
    if where_clauses:
        where_sql = "WHERE " + " AND ".join(where_clauses)

    return HistoryQueryParts(where_sql=where_sql, args=query_args)


def _resolve_sort_order(sort: str) -> str:
    if sort not in ALLOWED_SORT_ORDERS:
        raise HTTPException(status_code=422, detail="Invalid sort filter. Use newest or oldest.")

    return "DESC" if sort == "newest" else "ASC"


def _resolve_csv_timezone(timezone_name: str) -> tuple[ZoneInfo, str]:
    try:
        return ZoneInfo(timezone_name), _slugify_filename_part(timezone_name)
    except ZoneInfoNotFoundError:
        return ZoneInfo("UTC"), "utc"


def _slugify_filename_part(value: str) -> str:
    lowered = value.strip().lower()
    normalized = re.sub(r"[^a-z0-9]+", "-", lowered)
    cleaned = normalized.strip("-")
    return cleaned or "all"


CSV_FILENAME_TZ, CSV_FILENAME_TZ_SUFFIX = _resolve_csv_timezone(CSV_FILENAME_TIMEZONE)


def _validate_page_size(page_size: int) -> int:
    if page_size > HISTORY_MAX_PAGE_SIZE:
        raise HTTPException(status_code=422, detail=f"page_size cannot exceed configured max of {HISTORY_MAX_PAGE_SIZE}")

    return page_size


def _build_history_export_filename(status: str | None, start_date: str | None, end_date: str | None, sort: str) -> str:
    parts: list[str] = [_slugify_filename_part(CSV_FILENAME_PREFIX)]

    if status:
        parts.append(f"status-{_slugify_filename_part(status)}")
    if start_date:
        parts.append(f"from-{start_date}")
    if end_date:
        parts.append(f"to-{end_date}")

    parts.append(f"sort-{sort}")
    parts.append(datetime.now(CSV_FILENAME_TZ).strftime("%Y%m%d-%H%M%S"))
    parts.append(f"tz-{CSV_FILENAME_TZ_SUFFIX}")
    return "_".join(parts) + ".csv"


def _count_prediction_history(query_parts: HistoryQueryParts) -> int:
    count_sql = f"SELECT COUNT(*) FROM prediction_results {query_parts.where_sql}"

    with _db_lock:
        with sqlite3.connect(DATABASE_PATH) as connection:
            total = connection.execute(count_sql, query_parts.args).fetchone()[0]

    return int(total)


def _load_prediction_history(
    page: int,
    page_size: int,
    status: str | None,
    start_date: str | None,
    end_date: str | None,
    sort: str,
) -> tuple[list[HistoryRecord], int]:
    query_parts = _build_history_query_parts(status, start_date, end_date)
    order_sql = _resolve_sort_order(sort)
    total = _count_prediction_history(query_parts)

    offset = (page - 1) * page_size

    query_sql = f"""
        SELECT
            id,
            created_at,
            resolved_region_name,
            risk_score,
            status,
            rainfall_mm_used,
            temperature_c_used,
            weather_autofilled,
            confidence_lower,
            confidence_upper
        FROM prediction_results
        {query_parts.where_sql}
        ORDER BY id {order_sql}
        LIMIT ? OFFSET ?
    """
    query_args: list[str | int] = [*query_parts.args, page_size, offset]

    with _db_lock:
        with sqlite3.connect(DATABASE_PATH) as connection:
            rows = connection.execute(query_sql, query_args).fetchall()

    history_records: list[HistoryRecord] = []
    for row in rows:
        # Some older rows may have NULL confidence columns; fall back to a
        # conservative default (risk_score +/- 10) to avoid server errors.
        risk_score_val = int(row[3])
        raw_lower = row[8]
        raw_upper = row[9]
        confidence_lower_val = float(raw_lower) if raw_lower is not None else max(0.0, float(risk_score_val) - 10.0)
        confidence_upper_val = float(raw_upper) if raw_upper is not None else min(100.0, float(risk_score_val) + 10.0)

        history_records.append(
            HistoryRecord(
                prediction_id=int(row[0]),
                created_at=str(row[1]),
                region_name=str(row[2]),
                risk_score=risk_score_val,
                status=str(row[4]),
                rainfall_mm_used=float(row[5]),
                temperature_c_used=float(row[6]),
                weather_autofilled=bool(row[7]),
                confidence_lower=confidence_lower_val,
                confidence_upper=confidence_upper_val,
            )
        )

    return history_records, total


def _load_prediction_history_for_export(
    status: str | None,
    start_date: str | None,
    end_date: str | None,
    max_rows: int,
    sort: str,
) -> list[HistoryRecord]:
    query_parts = _build_history_query_parts(status, start_date, end_date)
    order_sql = _resolve_sort_order(sort)

    query_sql = f"""
        SELECT
            id,
            created_at,
            resolved_region_name,
            risk_score,
            status,
            rainfall_mm_used,
            temperature_c_used,
            weather_autofilled,
            confidence_lower,
            confidence_upper
        FROM prediction_results
        {query_parts.where_sql}
        ORDER BY id {order_sql}
        LIMIT ?
    """

    query_args: list[str | int] = [*query_parts.args, max_rows]

    with _db_lock:
        with sqlite3.connect(DATABASE_PATH) as connection:
            rows = connection.execute(query_sql, query_args).fetchall()

    return [
        HistoryRecord(
            prediction_id=int(row[0]),
            created_at=str(row[1]),
            region_name=str(row[2]),
            risk_score=int(row[3]),
            status=str(row[4]),
            rainfall_mm_used=float(row[5]),
            temperature_c_used=float(row[6]),
            weather_autofilled=bool(row[7]),
            confidence_lower=(float(row[8]) if row[8] is not None else max(0.0, float(row[3]) - 10.0)),
            confidence_upper=(float(row[9]) if row[9] is not None else min(100.0, float(row[3]) + 10.0)),
        )
        for row in rows
    ]


def _build_grounded_assistant_summary(question: str | None) -> dict[str, str | int | float | list[str]]:
    with _db_lock:
        with sqlite3.connect(DATABASE_PATH) as connection:
            latest_daily = connection.execute(
                """
                SELECT
                    date_key,
                    total_predictions,
                    avg_risk_score,
                    safe_count,
                    warning_count,
                    critical_count
                FROM features_daily
                ORDER BY date_key DESC
                LIMIT 1
                """
            ).fetchone()

            top_regions = connection.execute(
                """
                SELECT region_name, AVG(risk_score) AS avg_risk
                FROM region_risk_trends
                WHERE created_at >= datetime('now', '-7 day')
                GROUP BY region_name
                ORDER BY avg_risk DESC
                LIMIT 3
                """
            ).fetchall()

            alert_counts = connection.execute(
                """
                SELECT
                    SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) AS critical_alerts,
                    SUM(CASE WHEN severity = 'warning' THEN 1 ELSE 0 END) AS warning_alerts
                FROM alerts
                WHERE is_active = 1 AND created_at >= datetime('now', '-7 day')
                """
            ).fetchone()

    if latest_daily is None:
        return {
            "summary": "No analytics records are available yet. Submit at least one report and I will return a grounded surveillance summary.",
            "total_predictions_today": 0,
            "average_risk_today": 0.0,
            "critical_alerts_week": 0,
            "warning_alerts_week": 0,
            "top_regions": [],
            "question": question or "",
        }

    top_region_labels = [f"{str(row[0])} ({round(float(row[1]), 1)}/100)" for row in top_regions]
    critical_alerts = int(alert_counts[0] or 0) if alert_counts is not None else 0
    warning_alerts = int(alert_counts[1] or 0) if alert_counts is not None else 0

    summary = (
        f"Grounded update for {latest_daily[0]}: {int(latest_daily[1])} predictions logged with average risk "
        f"{round(float(latest_daily[2]), 1)}/100. Status split is {int(latest_daily[3])} Safe, "
        f"{int(latest_daily[4])} Warning, and {int(latest_daily[5])} Critical. "
        f"In the last 7 days, alerts tracked are {critical_alerts} critical and {warning_alerts} warning."
    )

    if top_region_labels:
        summary += f" Highest-risk regions this week: {', '.join(top_region_labels)}."

    return {
        "summary": summary,
        "total_predictions_today": int(latest_daily[1]),
        "average_risk_today": round(float(latest_daily[2]), 1),
        "critical_alerts_week": critical_alerts,
        "warning_alerts_week": warning_alerts,
        "top_regions": top_region_labels,
        "question": question or "",
    }


@app.get("/")
def health_check() -> dict[str, str]:
    return {"message": "Outbreak Radar backend is running"}


@app.get("/history")
def get_prediction_history(
    request: Request,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1),
    status: str | None = Query(default=None),
    start_date: str | None = Query(default=None),
    end_date: str | None = Query(default=None),
    sort: str = Query(default="newest"),
) -> dict[str, int | str | list[dict[str, int | str | float | bool]]]:
    # Capture Origin header for potential debugging (no-op in production)
    _origin = request.headers.get("origin")

    validated_page_size = _validate_page_size(page_size)
    history_items, total = _load_prediction_history(page, validated_page_size, status, start_date, end_date, sort)
    return {
        "page": page,
        "page_size": validated_page_size,
        "sort": sort,
        "total": total,
        "count": len(history_items),
        "items": [item.model_dump() for item in history_items],
    }


@app.get("/history/export.csv")
def export_prediction_history_csv(
    status: str | None = Query(default=None),
    start_date: str | None = Query(default=None),
    end_date: str | None = Query(default=None),
    max_rows: int = Query(default=5000, ge=1, le=20000),
    sort: str = Query(default="newest"),
) -> StreamingResponse:
    history_items = _load_prediction_history_for_export(status, start_date, end_date, max_rows, sort)

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "prediction_id",
            "created_at",
            "region_name",
            "risk_score",
            "status",
            "rainfall_mm_used",
            "temperature_c_used",
            "weather_autofilled",
            "confidence_lower",
            "confidence_upper",
        ]
    )

    for item in history_items:
        writer.writerow(
            [
                item.prediction_id,
                item.created_at,
                item.region_name,
                item.risk_score,
                item.status,
                item.rainfall_mm_used,
                item.temperature_c_used,
                item.weather_autofilled,
                item.confidence_lower,
                item.confidence_upper,
            ]
        )

    csv_content = output.getvalue()
    output.close()

    filename = _build_history_export_filename(status, start_date, end_date, sort)
    response = StreamingResponse(iter([csv_content]), media_type="text/csv")
    response.headers["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response


@app.get("/assistant/grounded-summary")
def grounded_assistant_summary(question: str | None = Query(default=None)) -> dict[str, str | int | float | list[str]]:
    return _build_grounded_assistant_summary(question)


@app.get("/assistant/debug")
def assistant_debug() -> dict:
    """Safe debug endpoint: reports whether an assistant API key is present and whether the
    configured provider host resolves via DNS. This endpoint DOES NOT return the key value.
    Use it locally to confirm the running process can see the configured environment.
    """
    provider = (ASSISTANT_PROVIDER or "").lower()
    info: dict[str, object] = {"provider": provider, "has_key": bool(ASSISTANT_API_KEY)}

    host: str | None = None
    if provider == "openai":
        host = "api.openai.com"
    elif provider == "anthropic":
        host = "api.anthropic.com"
    elif provider == "groq":
        try:
            host = urllib.parse.urlparse(os.getenv("ASSISTANT_GROQ_URL", "https://api.groq.com/openai/v1/chat/completions")).hostname
        except Exception:
            host = "api.groq.ai"

    if host:
        try:
            resolved = socket.gethostbyname(host)
            info["provider_host_resolves"] = True
            info["provider_host"] = host
            info["provider_host_ip"] = resolved
        except Exception as e:
            info["provider_host_resolves"] = False
            info["provider_host"] = host
            info["provider_host_error"] = str(e)
    else:
        info["provider_host_resolves"] = False

    return info


def _call_openai_chat(messages: list[dict], model: str | None = None) -> dict:
    if not ASSISTANT_API_KEY:
        raise HTTPException(status_code=403, detail="Assistant API key is not configured")

    url = "https://api.openai.com/v1/chat/completions"
    headers = {"Authorization": f"Bearer {ASSISTANT_API_KEY}", "Content-Type": "application/json"}
    payload = {"model": model or ASSISTANT_OPENAI_MODEL, "messages": messages, "temperature": 0.2}

    try:
        resp = httpx.post(url, headers=headers, json=payload, timeout=15.0)
        resp.raise_for_status()
        return resp.json()
    except (httpx.ConnectError, socket.gaierror) as e:
        # Network / DNS errors are common when a machine is offline or behind a restrictive proxy/firewall.
        raise HTTPException(
            status_code=502,
            detail=(
                "Assistant provider request failed: network/DNS error while contacting OpenAI. "
                "Check your network, proxy or firewall. On Windows try: `Test-NetConnection api.openai.com -Port 443`."
            ),
        ) from e
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Assistant provider request failed: {e}") from e


def _call_anthropic_chat(messages: list[dict], model: str | None = None) -> dict:
    if not ASSISTANT_API_KEY:
        raise HTTPException(status_code=403, detail="Assistant API key is not configured")

    # Build a single-prompt representation for Anthropic's completion API
    system = next((m.get("content", "") for m in messages if m.get("role") == "system"), "")
    user = next((m.get("content", "") for m in messages if m.get("role") == "user"), "")

    prompt = f"{system}\n\nHuman: {user}\n\nAssistant:"

    url = "https://api.anthropic.com/v1/complete"
    headers = {"x-api-key": ASSISTANT_API_KEY, "Content-Type": "application/json"}
    payload = {
        "model": model or "claude-2.1",
        "prompt": prompt,
        "max_tokens_to_sample": 512,
        "temperature": 0.2,
    }

    try:
        resp = httpx.post(url, headers=headers, json=payload, timeout=20.0)
        resp.raise_for_status()
        return resp.json()
    except (httpx.ConnectError, socket.gaierror) as e:
        raise HTTPException(
            status_code=502,
            detail=(
                "Assistant provider request failed: network/DNS error while contacting Anthropic. "
                "Check your network, proxy or firewall. On Windows try: `Test-NetConnection api.anthropic.com -Port 443`."
            ),
        ) from e
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Assistant provider request failed: {e}") from e


def _call_groq_chat(messages: list[dict], model: str | None = None) -> dict:
    if not ASSISTANT_API_KEY:
        raise HTTPException(status_code=403, detail="Assistant API key is not configured")

    # Build a single-prompt representation for Groq's completions API
    system = next((m.get("content", "") for m in messages if m.get("role") == "system"), "")
    user = next((m.get("content", "") for m in messages if m.get("role") == "user"), "")

    prompt = f"{system}\n\nHuman: {user}\n\nAssistant:"

    url = os.getenv("ASSISTANT_GROQ_URL", "https://api.groq.com/openai/v1/chat/completions")
    headers = {"Authorization": f"Bearer {ASSISTANT_API_KEY}", "Content-Type": "application/json"}
    payload = {
        "model": model or ASSISTANT_GROQ_MODEL,
        "messages": messages,
        "max_tokens": 512,
    }

    try:
        resp = httpx.post(url, headers=headers, json=payload, timeout=20.0)
        resp.raise_for_status()
        return resp.json()
    except (httpx.ConnectError, socket.gaierror) as e:
        raise HTTPException(
            status_code=502,
            detail=(
                "Assistant provider request failed: network/DNS error while contacting Groq. "
                "Check your network, proxy or firewall. On Windows try: `Test-NetConnection api.groq.ai -Port 443`."
            ),
        ) from e
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Assistant provider request failed: {e}") from e


@app.post("/assistant/chat")
def assistant_chat(req: ChatRequest) -> dict:
    question = req.question.strip() if req and req.question else None
    if not question:
        raise HTTPException(status_code=422, detail="question is required")

    grounded = _build_grounded_assistant_summary(question)

    system_content = (
        f"You are an AI Field Assistant for outbreak surveillance. Use the following grounded summary of recent predictions to answer the user's question.\n\n{grounded['summary']}\n\n"
        "If the question asks for current risk by region, include specific regions and risk scores where appropriate. Be concise and factual."
    )

    messages = [
        {"role": "system", "content": system_content},
        {"role": "user", "content": question},
    ]

    if ASSISTANT_PROVIDER.lower() == "openai":
        resp_json = _call_openai_chat(messages)
        try:
            assistant_text = resp_json["choices"][0]["message"]["content"]
        except Exception:
            raise HTTPException(status_code=502, detail="Malformed response from assistant provider")
        return {"answer": assistant_text, "grounded_summary": grounded}

    if ASSISTANT_PROVIDER.lower() == "groq":
        resp_json = _call_groq_chat(messages)
        # Groq may return different shapes; attempt reasonable fallbacks
        assistant_text = ""
        try:
            if isinstance(resp_json, dict):
                if "completion" in resp_json:
                    assistant_text = resp_json["completion"]
                elif "output" in resp_json:
                    out = resp_json["output"]
                    if isinstance(out, list) and out:
                        first = out[0]
                        if isinstance(first, dict) and "text" in first:
                            assistant_text = first["text"]
                        elif isinstance(first, str):
                            assistant_text = first
                        else:
                            assistant_text = json.dumps(out)
                elif "choices" in resp_json:
                    c = resp_json["choices"]
                    if isinstance(c, list) and c:
                        assistant_text = c[0].get("message", {}).get("content", "")
            if not assistant_text:
                assistant_text = str(resp_json)
        except Exception:
            raise HTTPException(status_code=502, detail="Malformed response from Groq provider")
        return {"answer": assistant_text, "grounded_summary": grounded}

    if ASSISTANT_PROVIDER.lower() == "anthropic":
        resp_json = _call_anthropic_chat(messages)
        # Anthropic returns 'completion' as the text body
        try:
            assistant_text = resp_json.get("completion") or resp_json.get("completion_text") or ""
        except Exception:
            raise HTTPException(status_code=502, detail="Malformed response from assistant provider")
        return {"answer": assistant_text, "grounded_summary": grounded}

    raise HTTPException(status_code=501, detail=f"Assistant provider '{ASSISTANT_PROVIDER}' not supported")


@app.post("/predict-outbreak")
def predict_outbreak_risk(payload: OutbreakInput) -> dict[str, int | str | float | bool | None]:
    geolocation: GeoLocation | None = None
    weather_autofilled = False
    geocoding_error: Exception | None = None

    try:
        geolocation = geocode_region(payload.region_name)
    except Exception as error:
        geocoding_error = error

    rainfall_mm = payload.rainfall_mm
    temperature_c = payload.temperature_c

    if rainfall_mm is None or temperature_c is None:
        if geolocation is None:
            if geocoding_error is not None:
                raise HTTPException(status_code=502, detail=f"Failed to geocode region: {geocoding_error}") from geocoding_error

            raise HTTPException(
                status_code=422,
                detail="Could not find region coordinates for weather autofill; provide rainfall and temperature manually.",
            )

        try:
            weather = fetch_current_weather(geolocation.latitude, geolocation.longitude)
        except HTTPException:
            raise
        except Exception as error:
            raise HTTPException(status_code=502, detail=f"Failed to fetch weather data: {error}") from error

        if rainfall_mm is None:
            rainfall_mm = weather.rainfall_mm
            weather_autofilled = True
        if temperature_c is None:
            temperature_c = weather.temperature_c
            weather_autofilled = True

    if rainfall_mm is None or temperature_c is None:
        raise HTTPException(status_code=422, detail="Rainfall and temperature must be provided or resolvable via weather API")

    prediction = predict_outbreak(
        rainfall_mm=rainfall_mm,
        temperature_c=temperature_c,
        reported_fever_cases=payload.reported_fever_cases,
    )
    confidence_lower, confidence_upper = _build_confidence_band(
        risk_score=prediction.risk_score,
        reported_fever_cases=payload.reported_fever_cases,
        weather_autofilled=weather_autofilled,
    )

    resolved_region_name = geolocation.display_name if geolocation else payload.region_name
    prediction_id, _ = _save_prediction_result(
        payload=payload,
        resolved_region_name=resolved_region_name,
        latitude=geolocation.latitude if geolocation else None,
        longitude=geolocation.longitude if geolocation else None,
        rainfall_mm_used=rainfall_mm,
        temperature_c_used=temperature_c,
        weather_autofilled=weather_autofilled,
        risk_score=prediction.risk_score,
        status=prediction.status,
        confidence_lower=confidence_lower,
        confidence_upper=confidence_upper,
    )

    return {
        "prediction_id": prediction_id,
        "region_name": payload.region_name,
        "resolved_region_name": resolved_region_name,
        "risk_score": prediction.risk_score,
        "status": prediction.status,
        "rainfall_mm_used": rainfall_mm,
        "temperature_c_used": temperature_c,
        "weather_autofilled": weather_autofilled,
        "confidence_lower": confidence_lower,
        "confidence_upper": confidence_upper,
        "latitude": geolocation.latitude if geolocation else None,
        "longitude": geolocation.longitude if geolocation else None,
    }


run_database_migrations()
