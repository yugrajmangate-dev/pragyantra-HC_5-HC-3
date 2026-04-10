"use client";

import { useState } from "react";
import RecentAlertsLog from "@/components/RecentAlertsLog";
import ReportForm from "@/components/ReportForm";
import type { OutbreakResponse } from "@/components/ReportForm";
import RiskMap from "@/components/RiskMap";
import AIAssistant from "@/components/AIAssistant";
import CompetitionDemo from "@/components/CompetitionDemo";
import type { DemoReplayFocus } from "@/components/CompetitionDemo.types";

export default function Home() {
  const [latestPrediction, setLatestPrediction] = useState<OutbreakResponse | null>(null);
  const [demoReplayFocus, setDemoReplayFocus] = useState<DemoReplayFocus | null>(null);

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
    : latestPrediction;

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-slate-950 text-slate-100">
      <div className="pointer-events-none absolute -left-20 top-24 h-72 w-72 rounded-full bg-cyan-500/15 blur-3xl animate-float-slow" />
      <div className="pointer-events-none absolute -right-24 top-64 h-80 w-80 rounded-full bg-rose-500/10 blur-3xl animate-float-slow [animation-delay:2s]" />
      <div className="pointer-events-none absolute bottom-16 left-1/3 h-64 w-64 rounded-full bg-emerald-400/10 blur-3xl animate-float-slow [animation-delay:4s]" />

      <header className="relative border-b border-white/10 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.25em] text-cyan-300">Outbreak Radar</p>
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Health Surveillance Radar</h1>
          </div>
          <div className="rounded-full border border-cyan-300/40 bg-cyan-300/10 px-3 py-1 text-xs font-mono uppercase tracking-wider text-cyan-100">
            Live Monitoring
          </div>
        </div>
      </header>

      <main className="relative mx-auto grid w-full max-w-7xl flex-1 gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[7fr_3fr] lg:gap-6 lg:px-8">
        <div className="flex flex-col gap-5">
          <section className="animate-rise-in overflow-hidden rounded-2xl border border-white/10 bg-slate-900/90 shadow-xl shadow-cyan-900/20">
            <div className="border-b border-white/10 px-5 py-4">
              <h2 className="text-lg font-semibold">Live Geographical Risk Map</h2>
              <p className="text-sm text-slate-300">Map recenters and pins the latest reported region with live outbreak risk output.</p>
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
            <RecentAlertsLog limit={10} refreshToken={latestPrediction?.prediction_id ?? null} />
          </div>
        </div>

        <aside className="animate-rise-in flex flex-col gap-5 lg:sticky lg:top-5 lg:h-fit [animation-delay:220ms]">
          <ReportForm onPrediction={setLatestPrediction} />
          <AIAssistant />
        </aside>
      </main>
    </div>
  );
}
