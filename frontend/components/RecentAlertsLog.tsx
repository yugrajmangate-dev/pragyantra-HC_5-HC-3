"use client";

import { useEffect, useMemo, useState } from "react";

type HistoryItem = {
  prediction_id: number;
  created_at: string;
  region_name: string;
  risk_score: number;
  status: "Safe" | "Warning" | "Critical Outbreak Risk";
  rainfall_mm_used: number;
  temperature_c_used: number;
  weather_autofilled: boolean;
  confidence_lower: number;
  confidence_upper: number;
};

type HistoryResponse = {
  page: number;
  page_size: number;
  sort: "newest" | "oldest";
  total: number;
  count: number;
  items: HistoryItem[];
};

type RecentAlertsLogProps = {
  limit?: number;
  refreshToken?: number | null;
};

type StatusFilter = "All" | "Safe" | "Warning" | "Critical Outbreak Risk";
type SortFilter = "newest" | "oldest";

const STATUS_FILTER_OPTIONS: StatusFilter[] = ["All", "Safe", "Warning", "Critical Outbreak Risk"];

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");

function statusStyles(status: HistoryItem["status"]): string {
  if (status === "Critical Outbreak Risk") {
    return "border-rose-300/45 bg-rose-500/15 text-rose-100";
  }

  if (status === "Warning") {
    return "border-amber-300/45 bg-amber-500/15 text-amber-100";
  }

  return "border-emerald-300/45 bg-emerald-500/15 text-emerald-100";
}

function formatWeather(item: HistoryItem): string {
  return `${item.rainfall_mm_used.toFixed(1)} mm, ${item.temperature_c_used.toFixed(1)} C`;
}

function formatConfidenceBand(item: HistoryItem): string {
  return `${item.confidence_lower.toFixed(1)} - ${item.confidence_upper.toFixed(1)}`;
}

function formatLoggedAt(value: string): string {
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const parsedDate = new Date(normalized);
  if (Number.isNaN(parsedDate.getTime())) {
    return value;
  }

  return parsedDate.toLocaleString("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildPageLinks(currentPage: number, totalPages: number): Array<number | "ellipsis"> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  if (currentPage <= 4) {
    return [1, 2, 3, 4, 5, "ellipsis", totalPages];
  }

  if (currentPage >= totalPages - 3) {
    return [1, "ellipsis", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  }

  return [1, "ellipsis", currentPage - 1, currentPage, currentPage + 1, "ellipsis", totalPages];
}

type SparklineProps = {
  values: number[];
};

function TrendSparkline({ values }: SparklineProps) {
  const width = 84;
  const height = 24;

  const points = useMemo(() => {
    if (values.length === 0) {
      return "";
    }

    if (values.length === 1) {
      const y = height - ((values[0] / 100) * (height - 2)) - 1;
      return `2,${y} ${width - 2},${y}`;
    }

    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;

    return values
      .map((value, index) => {
        const x = (index / (values.length - 1)) * (width - 2) + 1;
        const y = height - (((value - min) / range) * (height - 4) + 2);
        return `${x},${y}`;
      })
      .join(" ");
  }, [values]);

  if (!points) {
    return <span className="text-xs text-slate-500">-</span>;
  }

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-6 w-24 overflow-visible" aria-label="Risk trend sparkline">
      <polyline points={points} fill="none" stroke="#22d3ee" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function RecentAlertsLog({ limit = 10, refreshToken = null }: RecentAlertsLogProps) {
  const [rows, setRows] = useState<HistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(limit);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All");
  const [sortFilter, setSortFilter] = useState<SortFilter>("newest");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [jumpPageInput, setJumpPageInput] = useState("1");

  const trendByRegion = useMemo(() => {
    const trendMap: Record<string, number[]> = {};

    [...rows].reverse().forEach((row) => {
      if (!trendMap[row.region_name]) {
        trendMap[row.region_name] = [];
      }
      trendMap[row.region_name].push(row.risk_score);
    });

    return trendMap;
  }, [rows]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageLinks = useMemo(() => buildPageLinks(page, totalPages), [page, totalPages]);

  useEffect(() => {
    setPage(1);
  }, [statusFilter, sortFilter, startDate, endDate, pageSize]);

  useEffect(() => {
    if (!refreshToken) {
      return;
    }
    setPage(1);
  }, [refreshToken]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  useEffect(() => {
    setJumpPageInput(String(page));
  }, [page]);

  function goToPage() {
    const parsed = Number(jumpPageInput);
    if (!Number.isFinite(parsed)) {
      return;
    }

    const rounded = Math.floor(parsed);
    const bounded = Math.min(totalPages, Math.max(1, rounded));
    setPage(bounded);
  }

  async function exportFilteredCsv() {
    const params = new URLSearchParams();
    if (statusFilter !== "All") {
      params.set("status", statusFilter);
    }
    params.set("sort", sortFilter);
    if (startDate) {
      params.set("start_date", startDate);
    }
    if (endDate) {
      params.set("end_date", endDate);
    }

    const response = await fetch(`${API_BASE_URL}/history/export.csv?${params.toString()}`, {
      method: "GET",
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error("CSV export failed");
    }

    const disposition = response.headers.get("content-disposition") ?? "";
    const filenameMatch = disposition.match(/filename="?([^";]+)"?/i);
    const downloadFilename = filenameMatch?.[1] ?? "alerts-history.csv";

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = downloadFilename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  useEffect(() => {
    let isMounted = true;

    async function loadHistory() {
      setError("");
      setIsLoading(true);

      try {
        const params = new URLSearchParams({
          page: String(page),
          page_size: String(pageSize),
        });
        if (statusFilter !== "All") {
          params.set("status", statusFilter);
        }
        params.set("sort", sortFilter);
        if (startDate) {
          params.set("start_date", startDate);
        }
        if (endDate) {
          params.set("end_date", endDate);
        }

        const response = await fetch(`${API_BASE_URL}/history?${params.toString()}`, {
          method: "GET",
          cache: "no-store",
        });

        if (!response.ok) {
          const text = await response.text().catch(() => "");
          throw new Error(`HTTP ${response.status} ${response.statusText}${text ? `: ${text}` : ""}`);
        }

        const payload: HistoryResponse = await response.json();
        if (isMounted) {
          setPage(payload.page);
          setPageSize(payload.page_size);
          setSortFilter(payload.sort);
          setRows(payload.items);
          setTotal(payload.total);
        }
      } catch (err) {
        if (isMounted) {
          setRows([]);
          setTotal(0);
          // Log detailed error to console for debugging in dev
          // and surface a concise message in the UI.
          console.error("Failed to load /history", err);
          if (err instanceof Error) {
            setError(`Unable to load alert history: ${err.message}`);
          } else {
            setError("Unable to load alert history from backend.");
          }
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadHistory();

    return () => {
      isMounted = false;
    };
  }, [page, pageSize, refreshToken, statusFilter, sortFilter, startDate, endDate]);

  return (
    <section className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-xl">
      <div className="flex flex-col gap-3 border-b border-white/10 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Recent Alerts Log</h2>
          <p className="text-sm text-slate-300">Latest model predictions saved in local incident history.</p>
        </div>

        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-white/10 bg-slate-950/45 px-3 py-2 text-xs text-slate-300">
          <div className="flex items-center gap-2">
            <svg viewBox="0 0 56 14" className="h-3.5 w-14" aria-hidden="true">
              <polyline points="1,12 16,9 29,10 41,5 55,3" fill="none" stroke="#22d3ee" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <span>Trend line</span>
          </div>
          <span className="h-1 w-1 rounded-full bg-slate-500" />
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />Safe</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-amber-400" />Warning</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-rose-400" />Critical</span>
        </div>
      </div>

      <div className="grid gap-3 border-b border-white/10 bg-slate-950/40 px-5 py-4 sm:grid-cols-6">
        <label className="text-xs text-slate-300">
          <span className="mb-1 block uppercase tracking-wide text-slate-400">Status</span>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
            className="w-full rounded-lg border border-slate-600 bg-slate-900 px-2.5 py-2 text-sm text-slate-100 outline-none ring-cyan-300 transition focus:ring-2"
          >
            {STATUS_FILTER_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs text-slate-300">
          <span className="mb-1 block uppercase tracking-wide text-slate-400">From</span>
          <input
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
            className="w-full rounded-lg border border-slate-600 bg-slate-900 px-2.5 py-2 text-sm text-slate-100 outline-none ring-cyan-300 transition focus:ring-2"
          />
        </label>

        <label className="text-xs text-slate-300">
          <span className="mb-1 block uppercase tracking-wide text-slate-400">To</span>
          <input
            type="date"
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
            className="w-full rounded-lg border border-slate-600 bg-slate-900 px-2.5 py-2 text-sm text-slate-100 outline-none ring-cyan-300 transition focus:ring-2"
          />
        </label>

        <label className="text-xs text-slate-300">
          <span className="mb-1 block uppercase tracking-wide text-slate-400">Sort</span>
          <select
            value={sortFilter}
            onChange={(event) => setSortFilter(event.target.value as SortFilter)}
            className="w-full rounded-lg border border-slate-600 bg-slate-900 px-2.5 py-2 text-sm text-slate-100 outline-none ring-cyan-300 transition focus:ring-2"
          >
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
          </select>
        </label>

        <label className="text-xs text-slate-300">
          <span className="mb-1 block uppercase tracking-wide text-slate-400">Rows</span>
          <select
            value={pageSize}
            onChange={(event) => setPageSize(Number(event.target.value))}
            className="w-full rounded-lg border border-slate-600 bg-slate-900 px-2.5 py-2 text-sm text-slate-100 outline-none ring-cyan-300 transition focus:ring-2"
          >
            {[5, 10, 15].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-end">
          <div className="flex w-full gap-2">
            <button
              type="button"
              onClick={() => {
                setStatusFilter("All");
                setSortFilter("newest");
                setStartDate("");
                setEndDate("");
              }}
              className="w-full rounded-lg border border-slate-600 bg-slate-900 px-2.5 py-2 text-sm text-slate-100 transition hover:bg-slate-800"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => {
                exportFilteredCsv().catch(() => setError("CSV export failed"));
              }}
              className="w-full rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-2.5 py-2 text-sm text-cyan-100 transition hover:bg-cyan-500/20"
            >
              Export CSV
            </button>
          </div>
        </div>
      </div>

      {isLoading ? <p className="px-5 py-6 text-sm text-slate-300">Loading recent alerts...</p> : null}
      {error ? <p className="px-5 py-6 text-sm text-red-300">{error}</p> : null}
      {!isLoading && !error && rows.length === 0 ? <p className="px-5 py-6 text-sm text-slate-300">No alerts yet.</p> : null}

      {!isLoading && !error && rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-950/55 text-left text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-4 py-3 font-medium">Region</th>
                <th className="px-4 py-3 font-medium">Score</th>
                <th className="px-4 py-3 font-medium">Confidence</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Weather Used</th>
                <th className="px-4 py-3 font-medium">Trend</th>
                <th className="px-4 py-3 font-medium">Logged At</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.prediction_id} className="border-t border-white/10 text-slate-200">
                  <td className="px-4 py-3 align-top">{row.region_name}</td>
                  <td className="px-4 py-3 align-top font-semibold">{row.risk_score}/100</td>
                  <td className="px-4 py-3 align-top text-slate-300">{formatConfidenceBand(row)}</td>
                  <td className="px-4 py-3 align-top">
                    <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-medium ${statusStyles(row.status)}`}>
                      {row.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <p>{formatWeather(row)}</p>
                    <p className="mt-1 text-xs text-slate-400">{row.weather_autofilled ? "Auto-fetched" : "Manual"}</p>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <TrendSparkline values={trendByRegion[row.region_name] ?? [row.risk_score]} />
                  </td>
                  <td className="px-4 py-3 align-top text-slate-300">{formatLoggedAt(row.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex items-center justify-between border-t border-white/10 bg-slate-950/35 px-4 py-3 text-xs text-slate-300">
            <span>
              Showing {rows.length} of {total} alerts
            </span>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1 text-slate-200 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Prev
              </button>
              <span>
                Page {page} / {totalPages}
              </span>

              <div className="flex max-w-[220px] items-center gap-1 overflow-x-auto sm:max-w-none">
                {pageLinks.map((link, index) => {
                  if (link === "ellipsis") {
                    return (
                      <span key={`ellipsis-${index}`} className="px-1 text-slate-400">
                        ...
                      </span>
                    );
                  }

                  const isActive = link === page;
                  return (
                    <button
                      key={link}
                      type="button"
                      onClick={() => setPage(link)}
                      className={`rounded-md border px-2 py-1 transition ${
                        isActive
                          ? "border-cyan-300/70 bg-cyan-400/20 text-cyan-100"
                          : "border-slate-600 bg-slate-900 text-slate-200 hover:bg-slate-800"
                      }`}
                    >
                      {link}
                    </button>
                  );
                })}
              </div>

              <input
                type="number"
                min={1}
                max={totalPages}
                value={jumpPageInput}
                onChange={(event) => setJumpPageInput(event.target.value)}
                className="w-16 rounded-md border border-slate-600 bg-slate-900 px-2 py-1 text-center text-slate-100 outline-none ring-cyan-300 transition focus:ring-2"
                aria-label="Jump to page"
              />
              <button
                type="button"
                onClick={goToPage}
                className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1 text-slate-200 transition hover:bg-slate-800"
              >
                Go
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                className="rounded-md border border-slate-600 bg-slate-900 px-2 py-1 text-slate-200 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
