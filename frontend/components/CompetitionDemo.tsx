"use client";

import { useEffect, useMemo, useState } from "react";
import type { DemoReplayFocus, ReplayStatus } from "@/components/CompetitionDemo.types";

type ReplayEvent = {
  t: string;
  region: string;
  risk: number;
  cases: number;
  status: ReplayStatus;
  latitude: number;
  longitude: number;
};

type ActionChoice = "deploy-testing" | "public-advisory" | "wait";

type CompetitionDemoProps = {
  onReplayFocusChange?: (focus: DemoReplayFocus | null) => void;
};

const REPLAY_EVENTS: ReplayEvent[] = [
  { t: "06:00", region: "Nairobi Urban Core", risk: 24, cases: 12, status: "Safe", latitude: -1.2864, longitude: 36.8172 },
  { t: "09:00", region: "Nairobi East Belt", risk: 36, cases: 18, status: "Safe", latitude: -1.2725, longitude: 36.8891 },
  { t: "12:00", region: "Mombasa Port Strip", risk: 49, cases: 25, status: "Warning", latitude: -4.0435, longitude: 39.6682 },
  { t: "15:00", region: "Kisumu Lake Fringe", risk: 58, cases: 31, status: "Warning", latitude: -0.0917, longitude: 34.768 },
  { t: "18:00", region: "Nakuru Transit Hub", risk: 67, cases: 38, status: "Warning", latitude: -0.3031, longitude: 36.08 },
  { t: "21:00", region: "Kakamega Market Zone", risk: 76, cases: 47, status: "Critical Outbreak Risk", latitude: 0.2827, longitude: 34.7519 },
  { t: "00:00", region: "Garissa Corridor", risk: 84, cases: 56, status: "Critical Outbreak Risk", latitude: -0.4532, longitude: 39.646 },
  { t: "03:00", region: "Eldoret Peri-urban", risk: 90, cases: 69, status: "Critical Outbreak Risk", latitude: 0.5143, longitude: 35.2698 },
];

const ACTION_COPY: Record<ActionChoice, { label: string; effect: number; speedGainHours: number; trustBoost: number }> = {
  "deploy-testing": {
    label: "Deploy field testing now",
    effect: 0.44,
    speedGainHours: 28,
    trustBoost: 22,
  },
  "public-advisory": {
    label: "Send public advisory now",
    effect: 0.3,
    speedGainHours: 17,
    trustBoost: 16,
  },
  wait: {
    label: "Wait for confirmation",
    effect: 0.07,
    speedGainHours: 4,
    trustBoost: 2,
  },
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function statusFromRisk(riskScore: number): ReplayStatus {
  if (riskScore >= 70) {
    return "Critical Outbreak Risk";
  }

  if (riskScore >= 45) {
    return "Warning";
  }

  return "Safe";
}

function statusBadgeClass(status: ReplayStatus): string {
  if (status === "Critical Outbreak Risk") {
    return "border-rose-300/45 bg-rose-500/15 text-rose-100";
  }

  if (status === "Warning") {
    return "border-amber-300/45 bg-amber-500/15 text-amber-100";
  }

  return "border-emerald-300/45 bg-emerald-500/15 text-emerald-100";
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function redactSensitiveText(input: string): string {
  return input
    .replace(/[A-Z][a-z]+\s[A-Z][a-z]+/g, "[REDACTED_NAME]")
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[REDACTED_EMAIL]")
    .replace(/\+?\d[\d\s()-]{8,}\d/g, "[REDACTED_PHONE]")
    .replace(/\b\d{1,3}\.\d{4,}\b/g, "[REDACTED_COORD]")
    .replace(/\b(Street|Road|Lane|Avenue|Sector)\s+[\w-]+/gi, "[REDACTED_ADDRESS]");
}

export default function CompetitionDemo({ onReplayFocusChange }: CompetitionDemoProps) {
  const [tick, setTick] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [choice, setChoice] = useState<ActionChoice | null>(null);
  const [hasReplayStarted, setHasReplayStarted] = useState(false);
  const [mapSyncEnabled, setMapSyncEnabled] = useState(true);
  const [cinemaModeEnabled, setCinemaModeEnabled] = useState(true);
  const [rainfallShock, setRainfallShock] = useState(35);
  const [mobilityPressure, setMobilityPressure] = useState(44);
  const [reportingDelayHours, setReportingDelayHours] = useState(10);

  const scenarioEvents = useMemo(() => {
    return REPLAY_EVENTS.map((event) => {
      const riskNudge = rainfallShock * 0.15 + mobilityPressure * 0.18 + reportingDelayHours * 0.7;
      const adjustedRisk = Math.round(clamp(event.risk + riskNudge, 0, 100));

      const caseMultiplier = 1 + rainfallShock / 180 + mobilityPressure / 170 + reportingDelayHours / 120;
      const adjustedCases = Math.round(event.cases * caseMultiplier);

      return {
        ...event,
        risk: adjustedRisk,
        cases: adjustedCases,
        status: statusFromRisk(adjustedRisk),
      };
    });
  }, [rainfallShock, mobilityPressure, reportingDelayHours]);

  const current = scenarioEvents[tick];
  const timeline = scenarioEvents.slice(0, tick + 1);

  useEffect(() => {
    if (!isPlaying) {
      return;
    }

    const timer = setInterval(() => {
      setTick((previous) => {
        if (previous >= scenarioEvents.length - 1) {
          setIsPlaying(false);
          return previous;
        }
        return previous + 1;
      });
    }, 850);

    return () => clearInterval(timer);
  }, [isPlaying, scenarioEvents.length]);

  useEffect(() => {
    if (!onReplayFocusChange) {
      return;
    }

    if (!mapSyncEnabled || !hasReplayStarted) {
      onReplayFocusChange(null);
      return;
    }

    onReplayFocusChange({
      clock: current.t,
      region: current.region,
      riskScore: current.risk,
      cases: current.cases,
      status: current.status,
      latitude: current.latitude,
      longitude: current.longitude,
      progress: ((tick + 1) / scenarioEvents.length) * 100,
    });
  }, [onReplayFocusChange, mapSyncEnabled, hasReplayStarted, current, tick, scenarioEvents.length]);

  useEffect(() => {
    return () => {
      onReplayFocusChange?.(null);
    };
  }, [onReplayFocusChange]);

  const progress = ((tick + 1) / scenarioEvents.length) * 100;
  const baseCasesAtPeak = Math.max(...scenarioEvents.map((event) => event.cases));

  const simulation = useMemo(() => {
    if (!choice) {
      return null;
    }

    const selected = ACTION_COPY[choice];
    const delayPenalty = clamp(reportingDelayHours * 0.008, 0, 0.22);
    const stressPenalty = clamp((rainfallShock + mobilityPressure) * 0.0018, 0, 0.18);
    const effectiveReduction = clamp(selected.effect - delayPenalty - stressPenalty, 0.04, 0.65);
    const preventedCases = Math.round(baseCasesAtPeak * effectiveReduction);
    const casesIfAction = baseCasesAtPeak - preventedCases;
    const casesIfNoAction = Math.round(baseCasesAtPeak * 1.22);

    return {
      label: selected.label,
      preventedCases,
      casesIfAction,
      casesIfNoAction,
      speedGainHours: selected.speedGainHours,
      trustBoost: selected.trustBoost,
      impact: preventedCases / Math.max(1, casesIfNoAction),
      effectiveReduction,
    };
  }, [baseCasesAtPeak, choice, reportingDelayHours, rainfallShock, mobilityPressure]);

  const safeShareSource = `Patient: Aisha Kamau\nPhone: +254 712 445 113\nEmail: aisha.kamau@localmail.org\nLocation: Street Oak-17, Geo 12.9932\nRegion: ${current.region}\nAlert: ${current.status} at risk ${current.risk}/100\nDelay Context: ${reportingDelayHours}h reporting lag`; 
  const safeShareRedacted = redactSensitiveText(safeShareSource);

  return (
    <section
      className={`animate-rise-in overflow-hidden rounded-2xl border border-cyan-300/25 bg-slate-900/90 shadow-xl shadow-cyan-900/25 [animation-delay:70ms] ${
        cinemaModeEnabled ? "ring-1 ring-cyan-300/25" : ""
      }`}
    >
      <div className="border-b border-white/10 bg-gradient-to-r from-cyan-500/15 via-sky-500/10 to-emerald-500/10 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-cyan-200">Signature Demo</p>
            <h2 className="text-lg font-semibold">Outbreak Time-Machine + Action Duel</h2>
            <p className="text-sm text-slate-200/90">Replay one day of escalation, pick an intervention, and show measurable impact in seconds.</p>
            <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] uppercase tracking-[0.14em] text-slate-200/90">
              <span className="rounded-full border border-cyan-300/40 bg-cyan-500/10 px-2 py-1">Layer 1: Replay</span>
              <span className="rounded-full border border-cyan-300/40 bg-cyan-500/10 px-2 py-1">Layer 2: Action Duel</span>
              <span className="rounded-full border border-cyan-300/40 bg-cyan-500/10 px-2 py-1">Layer 3: Safe Share</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (isPlaying) {
                  setIsPlaying(false);
                  return;
                }

                if (tick >= scenarioEvents.length - 1) {
                  setTick(0);
                }

                setHasReplayStarted(true);
                setIsPlaying(true);
              }}
              className="rounded-lg border border-cyan-300/40 bg-cyan-500/15 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-cyan-100 transition hover:bg-cyan-500/25"
            >
              {isPlaying ? "Pause Replay" : "Start Replay"}
            </button>
            <button
              type="button"
              onClick={() => {
                setIsPlaying(false);
                setTick(0);
                setChoice(null);
                setHasReplayStarted(false);
              }}
              className="rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-100 transition hover:bg-white/10"
            >
              Reset
            </button>
          </div>
        </div>
      </div>

      <div className="px-5 py-4">
        <div className="mb-4 rounded-xl border border-white/10 bg-slate-950/55 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Judge Control Board (What-if Engine)</h3>
            <div className="flex items-center gap-2 text-xs">
              <button
                type="button"
                onClick={() => setMapSyncEnabled((previous) => !previous)}
                className={`rounded-md border px-2 py-1 transition ${
                  mapSyncEnabled ? "border-cyan-300/50 bg-cyan-500/15 text-cyan-100" : "border-white/20 bg-white/5 text-slate-200"
                }`}
              >
                {mapSyncEnabled ? "Map Sync ON" : "Map Sync OFF"}
              </button>
              <button
                type="button"
                onClick={() => setCinemaModeEnabled((previous) => !previous)}
                className={`rounded-md border px-2 py-1 transition ${
                  cinemaModeEnabled ? "border-cyan-300/50 bg-cyan-500/15 text-cyan-100" : "border-white/20 bg-white/5 text-slate-200"
                }`}
              >
                {cinemaModeEnabled ? "Cinema ON" : "Cinema OFF"}
              </button>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <label className="text-xs text-slate-300">
              <span className="mb-1 block uppercase tracking-wide text-slate-400">Rainfall Shock ({rainfallShock})</span>
              <input
                type="range"
                min={0}
                max={100}
                value={rainfallShock}
                onChange={(event) => setRainfallShock(Number(event.target.value))}
                className="w-full accent-cyan-400"
              />
            </label>
            <label className="text-xs text-slate-300">
              <span className="mb-1 block uppercase tracking-wide text-slate-400">Mobility Pressure ({mobilityPressure})</span>
              <input
                type="range"
                min={0}
                max={100}
                value={mobilityPressure}
                onChange={(event) => setMobilityPressure(Number(event.target.value))}
                className="w-full accent-cyan-400"
              />
            </label>
            <label className="text-xs text-slate-300">
              <span className="mb-1 block uppercase tracking-wide text-slate-400">Reporting Delay ({reportingDelayHours}h)</span>
              <input
                type="range"
                min={0}
                max={36}
                value={reportingDelayHours}
                onChange={(event) => setReportingDelayHours(Number(event.target.value))}
                className="w-full accent-cyan-400"
              />
            </label>
          </div>
        </div>

        <div className="mb-4 h-2 w-full overflow-hidden rounded-full bg-slate-800">
          <div className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-sky-400 to-emerald-400 transition-all duration-500" style={{ width: `${progress}%` }} />
        </div>

        <div className="grid gap-4 lg:grid-cols-[6fr_4fr]">
          <div className="rounded-xl border border-white/10 bg-slate-950/50 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Live Replay Feed</h3>
              <span className="rounded-md border border-white/15 bg-slate-900 px-2 py-1 text-xs text-slate-200">Fast Clock: {current.t}</span>
            </div>

            <div className="mb-3 grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-white/10 bg-slate-900/70 p-3">
                <p className="text-[11px] uppercase tracking-wide text-slate-400">Active Region</p>
                <p className="mt-1 text-sm font-semibold text-slate-100">{current.region}</p>
              </div>
              <div className="rounded-lg border border-white/10 bg-slate-900/70 p-3">
                <p className="text-[11px] uppercase tracking-wide text-slate-400">Risk Score</p>
                <p className="mt-1 text-sm font-semibold text-cyan-200">{current.risk}/100</p>
              </div>
              <div className="rounded-lg border border-white/10 bg-slate-900/70 p-3">
                <p className="text-[11px] uppercase tracking-wide text-slate-400">Reported Cases</p>
                <p className="mt-1 text-sm font-semibold text-slate-100">{current.cases}</p>
              </div>
            </div>

            <div className="space-y-2">
              {timeline.map((event, index) => {
                const isCurrent = index === tick;
                return (
                  <div
                    key={`${event.t}-${event.region}`}
                    className={`flex items-center justify-between rounded-lg border px-3 py-2 transition ${
                      isCurrent ? "border-cyan-300/55 bg-cyan-500/10" : "border-white/10 bg-slate-900/45"
                    }`}
                  >
                    <div>
                      <p className="text-sm font-medium text-slate-100">{event.t} · {event.region}</p>
                      <p className="text-xs text-slate-400">Risk {event.risk}/100 · Cases {event.cases}</p>
                    </div>
                    <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-medium ${statusBadgeClass(event.status)}`}>
                      {event.status}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-slate-950/50 p-4">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-300">Choose Response Action</h3>
            <div className="space-y-2">
              {(Object.keys(ACTION_COPY) as ActionChoice[]).map((actionKey) => {
                const item = ACTION_COPY[actionKey];
                const active = actionKey === choice;
                return (
                  <button
                    key={actionKey}
                    type="button"
                    onClick={() => setChoice(actionKey)}
                    className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                      active
                        ? "border-emerald-300/50 bg-emerald-500/12"
                        : "border-white/15 bg-slate-900/65 hover:bg-slate-900"
                    }`}
                  >
                    <p className="text-sm font-medium text-slate-100">{item.label}</p>
                    <p className="text-xs text-slate-400">Baseline reduction impact: {pct(item.effect)}</p>
                  </button>
                );
              })}
            </div>

            {simulation ? (
              <div className="mt-4 space-y-3">
                <div className="rounded-lg border border-emerald-300/30 bg-emerald-500/10 p-3">
                  <p className="text-xs uppercase tracking-wide text-emerald-200">Action Duel Result</p>
                  <p className="mt-1 text-sm text-emerald-100">{simulation.label}</p>
                  <p className="mt-1 text-xs text-emerald-200/90">Adjusted effectiveness under this scenario: {pct(simulation.effectiveReduction)}</p>
                </div>

                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-lg border border-emerald-300/35 bg-emerald-500/10 p-3">
                    <p className="text-[11px] uppercase tracking-wide text-emerald-200">With Action</p>
                    <p className="mt-1 font-semibold text-emerald-100">{simulation.casesIfAction} cases</p>
                  </div>
                  <div className="rounded-lg border border-rose-300/35 bg-rose-500/10 p-3">
                    <p className="text-[11px] uppercase tracking-wide text-rose-200">No Action</p>
                    <p className="mt-1 font-semibold text-rose-100">{simulation.casesIfNoAction} cases</p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-lg border border-cyan-300/30 bg-cyan-500/10 p-2 text-cyan-100">
                    <p className="text-[10px] uppercase tracking-wide text-cyan-200">Cases Prevented</p>
                    <p className="mt-1 text-sm font-semibold">{simulation.preventedCases}</p>
                  </div>
                  <div className="rounded-lg border border-cyan-300/30 bg-cyan-500/10 p-2 text-cyan-100">
                    <p className="text-[10px] uppercase tracking-wide text-cyan-200">Response Speed</p>
                    <p className="mt-1 text-sm font-semibold">+{simulation.speedGainHours}h</p>
                  </div>
                  <div className="rounded-lg border border-cyan-300/30 bg-cyan-500/10 p-2 text-cyan-100">
                    <p className="text-[10px] uppercase tracking-wide text-cyan-200">Public Trust</p>
                    <p className="mt-1 text-sm font-semibold">+{simulation.trustBoost}%</p>
                  </div>
                </div>
              </div>
            ) : (
              <p className="mt-4 rounded-lg border border-white/10 bg-slate-900/50 p-3 text-xs text-slate-300">
                Choose an action to simulate branch outcomes for judges in real time.
              </p>
            )}
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-white/10 bg-slate-950/50 p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Safe Share Mode</h3>
            <span className="rounded-md border border-cyan-300/35 bg-cyan-500/10 px-2 py-1 text-[11px] uppercase tracking-wide text-cyan-100">
              Responsible AI Guardrail
            </span>
          </div>
          <p className="mb-3 text-xs text-slate-400">Before sharing alerts with partners or LLMs, sensitive details are auto-redacted.</p>

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-lg border border-rose-300/25 bg-rose-500/10 p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-rose-100">Original Incident Note</p>
              <pre className="whitespace-pre-wrap text-xs leading-relaxed text-rose-50/90">{safeShareSource}</pre>
            </div>
            <div className="rounded-lg border border-emerald-300/25 bg-emerald-500/10 p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-emerald-100">Safe-to-Share Summary</p>
              <pre className="whitespace-pre-wrap text-xs leading-relaxed text-emerald-50/90">{safeShareRedacted}</pre>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
