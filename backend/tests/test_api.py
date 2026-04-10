from __future__ import annotations

import importlib
import csv
import io
import sqlite3
from datetime import date, timedelta
from pathlib import Path
import sys
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


@pytest.fixture()
def app_module(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    database_path = tmp_path / "outbreak_radar_test.db"
    monkeypatch.setenv("OUTBREAK_DB_PATH", str(database_path))
    monkeypatch.setenv("WEATHER_CACHE_TTL_SECONDS", "900")
    monkeypatch.setenv("HISTORY_MAX_PAGE_SIZE", "25")
    monkeypatch.setenv("CSV_FILENAME_PREFIX", "judge-radar")
    monkeypatch.setenv("CSV_FILENAME_TIMEZONE", "UTC")

    import main

    module = importlib.reload(main)
    module.clear_weather_cache()
    return module


def test_predict_manual_inputs_persist_results(app_module, monkeypatch: pytest.MonkeyPatch):
    geocode_fetch_calls = {"count": 0}

    def fake_fetch_geocode(region_name: str):
        geocode_fetch_calls["count"] += 1
        return app_module.GeoLocation(
            display_name="Mumbai, Maharashtra, India",
            latitude=19.07283,
            longitude=72.88261,
        )

    monkeypatch.setattr(app_module, "_fetch_geocode_from_api", fake_fetch_geocode)

    client = TestClient(app_module.app)
    response = client.post(
        "/predict-outbreak",
        json={
            "region_name": "mumbai",
            "rainfall_mm": 75.5,
            "temperature_c": 30.2,
            "reported_fever_cases": 120,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["weather_autofilled"] is False
    assert body["rainfall_mm_used"] == 75.5
    assert body["temperature_c_used"] == 30.2
    assert isinstance(body["confidence_lower"], float)
    assert isinstance(body["confidence_upper"], float)
    assert body["confidence_lower"] <= body["risk_score"] <= body["confidence_upper"]
    assert geocode_fetch_calls["count"] == 1

    with sqlite3.connect(app_module.DATABASE_PATH) as connection:
        geocode_count = connection.execute("SELECT COUNT(*) FROM geocoding_results").fetchone()[0]
        prediction_count = connection.execute("SELECT COUNT(*) FROM prediction_results").fetchone()[0]
        trends_count = connection.execute("SELECT COUNT(*) FROM region_risk_trends").fetchone()[0]
        features_daily_count = connection.execute("SELECT COUNT(*) FROM features_daily").fetchone()[0]

    assert geocode_count == 1
    assert prediction_count == 1
    assert trends_count == 1
    assert features_daily_count == 1


def test_predict_weather_autofill_uses_cache(app_module, monkeypatch: pytest.MonkeyPatch):
    geocode_fetch_calls = {"count": 0}
    weather_fetch_calls = {"count": 0}

    def fake_fetch_geocode(region_name: str):
        geocode_fetch_calls["count"] += 1
        return app_module.GeoLocation(
            display_name="Mumbai, Maharashtra, India",
            latitude=19.07283,
            longitude=72.88261,
        )

    def fake_fetch_weather(latitude: float, longitude: float):
        weather_fetch_calls["count"] += 1
        return app_module.WeatherSnapshot(temperature_c=29.0, rainfall_mm=0.4)

    monkeypatch.setattr(app_module, "_fetch_geocode_from_api", fake_fetch_geocode)
    monkeypatch.setattr(app_module, "_fetch_current_weather_uncached", fake_fetch_weather)

    client = TestClient(app_module.app)

    first = client.post(
        "/predict-outbreak",
        json={
            "region_name": "mumbai",
            "rainfall_mm": None,
            "temperature_c": None,
            "reported_fever_cases": 140,
        },
    )
    second = client.post(
        "/predict-outbreak",
        json={
            "region_name": "mumbai",
            "rainfall_mm": None,
            "temperature_c": None,
            "reported_fever_cases": 145,
        },
    )

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["weather_autofilled"] is True
    assert second.json()["weather_autofilled"] is True

    assert geocode_fetch_calls["count"] == 1
    assert weather_fetch_calls["count"] == 1

    with sqlite3.connect(app_module.DATABASE_PATH) as connection:
        geocode_count = connection.execute("SELECT COUNT(*) FROM geocoding_results").fetchone()[0]
        prediction_count = connection.execute("SELECT COUNT(*) FROM prediction_results").fetchone()[0]

    assert geocode_count == 1
    assert prediction_count == 2


def test_manual_inputs_still_work_when_geocoding_temporarily_fails(app_module, monkeypatch: pytest.MonkeyPatch):
    def fail_geocode(_: str):
        raise RuntimeError("geocoding temporarily unavailable")

    monkeypatch.setattr(app_module, "geocode_region", fail_geocode)

    client = TestClient(app_module.app)
    response = client.post(
        "/predict-outbreak",
        json={
            "region_name": "unknown-place",
            "rainfall_mm": 40.0,
            "temperature_c": 26.0,
            "reported_fever_cases": 25,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["latitude"] is None
    assert body["longitude"] is None
    assert body["weather_autofilled"] is False


def test_history_endpoint_returns_recent_predictions(app_module, monkeypatch: pytest.MonkeyPatch):
    def fake_fetch_geocode(region_name: str):
        if region_name == "mumbai":
            return app_module.GeoLocation(
                display_name="Mumbai, Maharashtra, India",
                latitude=19.07283,
                longitude=72.88261,
            )

        return app_module.GeoLocation(
            display_name="Nairobi, Nairobi County, Kenya",
            latitude=-1.286389,
            longitude=36.817223,
        )

    monkeypatch.setattr(app_module, "_fetch_geocode_from_api", fake_fetch_geocode)

    client = TestClient(app_module.app)

    first_prediction = client.post(
        "/predict-outbreak",
        json={
            "region_name": "mumbai",
            "rainfall_mm": 80.0,
            "temperature_c": 30.0,
            "reported_fever_cases": 140,
        },
    )
    second_prediction = client.post(
        "/predict-outbreak",
        json={
            "region_name": "nairobi",
            "rainfall_mm": 20.0,
            "temperature_c": 24.0,
            "reported_fever_cases": 60,
        },
    )

    assert first_prediction.status_code == 200
    assert second_prediction.status_code == 200

    history_response = client.get("/history?page=1&page_size=2")
    assert history_response.status_code == 200

    body = history_response.json()
    assert body["page"] == 1
    assert body["page_size"] == 2
    assert body["sort"] == "newest"
    assert body["total"] == 2
    assert body["count"] == 2
    assert len(body["items"]) == 2

    newest_item = body["items"][0]
    older_item = body["items"][1]

    assert newest_item["prediction_id"] > older_item["prediction_id"]
    assert newest_item["region_name"] == "Nairobi, Nairobi County, Kenya"
    assert "rainfall_mm_used" in newest_item
    assert "temperature_c_used" in newest_item
    assert "confidence_lower" in newest_item
    assert "confidence_upper" in newest_item


def test_history_endpoint_supports_status_and_date_filters(app_module, monkeypatch: pytest.MonkeyPatch):
    def fake_fetch_geocode(region_name: str):
        return app_module.GeoLocation(
            display_name=f"{region_name.title()}, Testland",
            latitude=1.0,
            longitude=2.0,
        )

    def fake_predict_outbreak(rainfall_mm: float, temperature_c: float, reported_fever_cases: int):
        if reported_fever_cases >= 80:
            return SimpleNamespace(risk_score=90, status="Critical Outbreak Risk")
        return SimpleNamespace(risk_score=12, status="Safe")

    monkeypatch.setattr(app_module, "_fetch_geocode_from_api", fake_fetch_geocode)
    monkeypatch.setattr(app_module, "predict_outbreak", fake_predict_outbreak)

    client = TestClient(app_module.app)

    first_prediction = client.post(
        "/predict-outbreak",
        json={
            "region_name": "alpha",
            "rainfall_mm": 20.0,
            "temperature_c": 23.0,
            "reported_fever_cases": 10,
        },
    )
    second_prediction = client.post(
        "/predict-outbreak",
        json={
            "region_name": "beta",
            "rainfall_mm": 20.0,
            "temperature_c": 23.0,
            "reported_fever_cases": 120,
        },
    )

    assert first_prediction.status_code == 200
    assert second_prediction.status_code == 200

    safe_history = client.get("/history?page=1&page_size=10&status=Safe")
    assert safe_history.status_code == 200
    safe_items = safe_history.json()["items"]
    assert len(safe_items) == 1
    assert safe_items[0]["status"] == "Safe"

    tomorrow = (date.today() + timedelta(days=1)).isoformat()
    future_history = client.get(f"/history?page=1&page_size=10&start_date={tomorrow}")
    assert future_history.status_code == 200
    assert future_history.json()["count"] == 0


def test_history_endpoint_supports_oldest_sort_order(app_module, monkeypatch: pytest.MonkeyPatch):
    def fake_fetch_geocode(region_name: str):
        return app_module.GeoLocation(
            display_name=f"{region_name.title()}, Sortland",
            latitude=3.0,
            longitude=4.0,
        )

    monkeypatch.setattr(app_module, "_fetch_geocode_from_api", fake_fetch_geocode)

    client = TestClient(app_module.app)

    first_prediction = client.post(
        "/predict-outbreak",
        json={
            "region_name": "first",
            "rainfall_mm": 10.0,
            "temperature_c": 21.0,
            "reported_fever_cases": 20,
        },
    )
    second_prediction = client.post(
        "/predict-outbreak",
        json={
            "region_name": "second",
            "rainfall_mm": 10.0,
            "temperature_c": 21.0,
            "reported_fever_cases": 25,
        },
    )

    assert first_prediction.status_code == 200
    assert second_prediction.status_code == 200

    oldest_history = client.get("/history?page=1&page_size=10&sort=oldest")
    assert oldest_history.status_code == 200
    body = oldest_history.json()
    assert body["sort"] == "oldest"
    assert len(body["items"]) == 2
    assert body["items"][0]["prediction_id"] < body["items"][1]["prediction_id"]


def test_history_endpoint_enforces_env_max_page_size(app_module, monkeypatch: pytest.MonkeyPatch):
    def fake_fetch_geocode(region_name: str):
        return app_module.GeoLocation(
            display_name=f"{region_name.title()}, Pagingland",
            latitude=7.0,
            longitude=8.0,
        )

    monkeypatch.setattr(app_module, "_fetch_geocode_from_api", fake_fetch_geocode)

    client = TestClient(app_module.app)
    client.post(
        "/predict-outbreak",
        json={
            "region_name": "alpha",
            "rainfall_mm": 10.0,
            "temperature_c": 22.0,
            "reported_fever_cases": 30,
        },
    )

    response = client.get("/history?page=1&page_size=26")
    assert response.status_code == 422
    assert "configured max" in response.json()["detail"]


def test_history_csv_export_returns_filtered_rows(app_module, monkeypatch: pytest.MonkeyPatch):
    def fake_fetch_geocode(region_name: str):
        return app_module.GeoLocation(
            display_name=f"{region_name.title()}, Csvland",
            latitude=5.0,
            longitude=6.0,
        )

    def fake_predict_outbreak(rainfall_mm: float, temperature_c: float, reported_fever_cases: int):
        if reported_fever_cases >= 100:
            return SimpleNamespace(risk_score=88, status="Critical Outbreak Risk")
        return SimpleNamespace(risk_score=21, status="Safe")

    monkeypatch.setattr(app_module, "_fetch_geocode_from_api", fake_fetch_geocode)
    monkeypatch.setattr(app_module, "predict_outbreak", fake_predict_outbreak)

    client = TestClient(app_module.app)

    client.post(
        "/predict-outbreak",
        json={
            "region_name": "alpha",
            "rainfall_mm": 15.0,
            "temperature_c": 22.0,
            "reported_fever_cases": 10,
        },
    )
    client.post(
        "/predict-outbreak",
        json={
            "region_name": "beta",
            "rainfall_mm": 15.0,
            "temperature_c": 22.0,
            "reported_fever_cases": 120,
        },
    )

    csv_response = client.get(
        "/history/export.csv?status=Critical%20Outbreak%20Risk&sort=oldest&start_date=2026-01-01&end_date=2026-12-31"
    )
    assert csv_response.status_code == 200
    assert csv_response.headers["content-type"].startswith("text/csv")
    content_disposition = csv_response.headers.get("content-disposition", "")
    assert "judge-radar_" in content_disposition
    assert "status-critical-outbreak-risk" in content_disposition
    assert "sort-oldest" in content_disposition
    assert "tz-utc" in content_disposition

    reader = csv.DictReader(io.StringIO(csv_response.text))
    rows = list(reader)
    assert len(rows) == 1
    assert rows[0]["status"] == "Critical Outbreak Risk"
    assert rows[0]["region_name"] == "Beta, Csvland"
    assert "confidence_lower" in rows[0]
    assert "confidence_upper" in rows[0]


def test_grounded_assistant_summary_uses_analytics_tables(app_module, monkeypatch: pytest.MonkeyPatch):
    def fake_fetch_geocode(region_name: str):
        return app_module.GeoLocation(
            display_name=f"{region_name.title()}, Insightland",
            latitude=11.0,
            longitude=12.0,
        )

    def fake_predict_outbreak(rainfall_mm: float, temperature_c: float, reported_fever_cases: int):
        if reported_fever_cases >= 100:
            return SimpleNamespace(risk_score=92, status="Critical Outbreak Risk")
        if reported_fever_cases >= 60:
            return SimpleNamespace(risk_score=62, status="Warning")
        return SimpleNamespace(risk_score=18, status="Safe")

    monkeypatch.setattr(app_module, "_fetch_geocode_from_api", fake_fetch_geocode)
    monkeypatch.setattr(app_module, "predict_outbreak", fake_predict_outbreak)

    client = TestClient(app_module.app)
    client.post(
        "/predict-outbreak",
        json={
            "region_name": "alpha",
            "rainfall_mm": 10.0,
            "temperature_c": 22.0,
            "reported_fever_cases": 40,
        },
    )
    client.post(
        "/predict-outbreak",
        json={
            "region_name": "beta",
            "rainfall_mm": 10.0,
            "temperature_c": 22.0,
            "reported_fever_cases": 80,
        },
    )
    client.post(
        "/predict-outbreak",
        json={
            "region_name": "gamma",
            "rainfall_mm": 10.0,
            "temperature_c": 22.0,
            "reported_fever_cases": 130,
        },
    )

    response = client.get("/assistant/grounded-summary?question=top%20risk%20regions")
    assert response.status_code == 200
    body = response.json()

    assert "Grounded update" in body["summary"]
    assert body["question"] == "top risk regions"
    assert body["total_predictions_today"] == 3
    assert body["critical_alerts_week"] >= 1
    assert body["warning_alerts_week"] >= 1
    assert len(body["top_regions"]) >= 1
