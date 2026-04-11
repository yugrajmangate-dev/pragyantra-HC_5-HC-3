"use client";

import { useEffect, useState } from "react";
import RecentAlertsLog from "@/components/RecentAlertsLog";
import RiskMap from "@/components/RiskMap";
import AIAssistant from "@/components/AIAssistant";
import CompetitionDemo from "@/components/CompetitionDemo";
import type { DemoReplayFocus } from "@/components/CompetitionDemo.types";
import type { OutbreakResponse } from "@/components/ReportForm";

import Link from "next/link";
export default function AdminDashboard() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const [livePrediction, setLivePrediction] = useState<OutbreakResponse | null>(null);
  const [demoReplayFocus, setDemoReplayFocus] = useState<DemoReplayFocus | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);

  // Automatically refresh map and logs every 10 seconds to catch new submissions
  useEffect(() => {
    if (!isAuthenticated) return;
    
    async function fetchLatestAlert() {
      try {
        const url = (process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");
        const res = await fetch(`${url}/history?page=1&page_size=1&sort=newest`);
        if (res.ok) {
          const data = await res.json();
          if (data.items && data.items.length > 0) {
            const item = data.items[0];
            setLivePrediction({
              prediction_id: item.prediction_id,
              region_name: item.region_name,
              resolved_region_name: item.region_name,
              risk_score: item.risk_score,
              status: item.status,
              rainfall_mm_used: item.rainfall_mm_used,
              temperature_c_used: item.temperature_c_used,
              weather_autofilled: item.weather_autofilled,
              confidence_lower: item.confidence_lower,
              confidence_upper: item.confidence_upper,
              latitude: item.latitude || 0,
              longitude: item.longitude || 0,
            });
          }
        }
      } catch (err) {
        console.error("Failed to fetch latest alert for map", err);
      }
    }

    fetchLatestAlert();
    const interval = setInterval(() => {
      fetchLatestAlert();
      setRefreshTrigger(Date.now());
    }, 10000);
    return () => clearInterval(interval);
  }, [isAuthenticated]);

  function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (username === "admin" && password === "431103") {
      setIsAuthenticated(true);
      setError("");
    } else {
      setError("Invalid credentials");
    }
  }

  const mapPrediction: OutbreakResponse | null = demoReplayFocus
    ? {
        prediction_id: -1,
        region_name: demoReplayFocus.region,
        resolved_region_name: `${demoReplayFocus.region} (Replay)`,
        risk_score: demoReplayFocus.riskScore,
        status: demoReplayFocus.status,
        rainfall_mm_used: 0,
        temperature_c_used: 0,
        weather_autofilled: true,
        confidence_lower: Math.max(0, demoReplayFocus.riskScore - 9),
        confidence_upper: Math.min(100, demoReplayFocus.riskScore + 9),
        latitude: demoReplayFocus.latitude,
        longitude: demoReplayFocus.longitude,
      }
    : livePrediction;

  if (!isAuthenticated) {
    return (
      <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-slate-950 text-slate-100 p-4">
        <div className="pointer-events-none absolute -left-20 top-24 h-72 w-72 rounded-full bg-cyan-500/15 blur-3xl animate-float-slow" />
        <div className="pointer-events-none absolute -right-24 top-64 h-80 w-80 rounded-full bg-rose-500/10 blur-3xl animate-float-slow [animation-delay:2s]" />

        <div className="z-10 w-full max-w-md rounded-2xl border border-white/10 bg-slate-900/90 p-8 shadow-xl shadow-cyan-900/20 backdrop-blur">
          <h1 className="mb-2 text-2xl font-semibold text-center text-cyan-100">Health Authority Portal</h1>
          <p className="mb-6 text-center text-sm text-slate-400">Secure Access for Authorized Personnel Only</p>

          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            <div>
              <label className="text-sm font-medium text-slate-300">Admin ID</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-200 outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
                autoComplete="off"
                required
              />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-300">Passcode</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm text-slate-200 outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
                autoComplete="off"
                required
              />
            </div>
            {error && <p className="text-sm text-rose-400">{error}</p>}
            <button
              type="submit"
              className="mt-2 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-500 active:bg-cyan-700"
            >
              Sign In to Admin Dashboard
            </button>
          </form>
          <div className="mt-6 text-center text-xs text-slate-500">
            <Link href="/" className="hover:text-cyan-400 underline decoration-slate-500 underline-offset-4">Return to Public Clinic Portal</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-slate-950 text-slate-100">
      <div className="pointer-events-none absolute -left-20 top-24 h-72 w-72 rounded-full bg-cyan-500/15 blur-3xl animate-float-slow" />
      <div className="pointer-events-none absolute -right-24 top-64 h-80 w-80 rounded-full bg-rose-500/10 blur-3xl animate-float-slow [animation-delay:2s]" />
      <div className="pointer-events-none absolute bottom-16 left-1/3 h-64 w-64 rounded-full bg-emerald-400/10 blur-3xl animate-float-slow [animation-delay:4s]" />

      <header className="relative border-b border-white/10 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.25em] text-rose-400">Restricted Access</p>
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl text-cyan-50">Admin Control Center</h1>
          </div>
          <div className="flex gap-4 items-center">
            <div className="rounded-full border border-cyan-300/40 bg-cyan-300/10 px-3 py-1 text-xs font-mono uppercase tracking-wider text-cyan-100 object-none">
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 mr-2 animate-pulse"></span>Live Monitor
            </div>
            <button 
              onClick={() => setIsAuthenticated(false)}
              className="text-xs text-slate-400 hover:text-white"
            >
              Log out
            </button>
          </div>
        </div>
      </header>

      <main className="relative mx-auto grid w-full max-w-7xl flex-1 gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[7fr_3fr] lg:gap-6 lg:px-8">
        <div className="flex flex-col gap-5">
          <section className="animate-rise-in overflow-hidden rounded-2xl border border-white/10 bg-slate-900/90 shadow-xl shadow-cyan-900/20">
            <div className="border-b border-white/10 px-5 py-4">
              <h2 className="text-lg font-semibold">Live Geographical Risk Map</h2>
              <p className="text-sm text-slate-300">Map recenters automatically. Auto-refreshes every 10s to fetch new clinic reports.</p>
            </div>

            <div className="relative h-[360px] md:h-[480px]">
              <RiskMap prediction={mapPrediction} />
              <div className="pointer-events-none absolute right-4 top-4 rounded-lg border border-white/20 bg-slate-950/80 px-3 py-2 text-xs backdrop-blur">
                <p className="mb-1 font-semibold text-slate-100">Legend</p>
                <p className="text-emerald-300">Safe</p>
                <p className="text-amber-300">Warning</p>
                <p className="text-rose-300">Critical Outbreak Risk</p>
              </div>
              {demoReplayFocus ? (
                <div className="pointer-events-none absolute bottom-4 left-4 rounded-lg border border-cyan-300/45 bg-slate-950/85 px-3 py-2 text-xs text-cyan-100 backdrop-blur">
                  Replay Sync Active · {demoReplayFocus.clock} · {demoReplayFocus.region}
                </div>
              ) : null}
            </div>
          </section>

          <CompetitionDemo onReplayFocusChange={setDemoReplayFocus} />

          <div className="animate-rise-in [animation-delay:140ms]">
            <RecentAlertsLog limit={10} refreshToken={refreshTrigger} />
          </div>
        </div>

        <aside className="animate-rise-in flex flex-col gap-5 lg:sticky lg:top-5 lg:h-fit [animation-delay:220ms]">
          <AIAssistant />
        </aside>
      </main>
    </div>
  );
}
