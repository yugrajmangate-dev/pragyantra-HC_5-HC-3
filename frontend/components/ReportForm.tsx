"use client";

import { FormEvent, useMemo, useState } from "react";

export type OutbreakResponse = {
  prediction_id: number;
  region_name: string;
  resolved_region_name: string;
  risk_score: number;
  status: "Safe" | "Warning" | "Critical Outbreak Risk";
  rainfall_mm_used: number;
  temperature_c_used: number;
  weather_autofilled: boolean;
  confidence_lower: number;
  confidence_upper: number;
  latitude: number | null;
  longitude: number | null;
};

type ReportFormProps = {
  onPrediction?: (prediction: OutbreakResponse | null) => void;
};

const INITIAL_FORM = {
  region_name: "",
  rainfall_mm: "",
  temperature_c: "",
  reported_fever_cases: "",
};

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");

function parseOptionalNumber(value: string): number | null {
  if (value.trim() === "") {
    return null;
  }

  return Number(value);
}


export default function ReportForm({ onPrediction }: ReportFormProps) {
  const [formValues, setFormValues] = useState(INITIAL_FORM);
  const [result, setResult] = useState<OutbreakResponse | null>(null);
  const [error, setError] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const statusStyles = useMemo(() => {
    if (!result) {
      return "";
    }

    if (result.status === "Critical Outbreak Risk") {
      return "border-red-400/60 bg-red-500/15 text-red-100";
    }

    if (result.status === "Warning") {
      return "border-amber-300/60 bg-amber-500/15 text-amber-100";
    }

    return "border-emerald-300/60 bg-emerald-500/15 text-emerald-100";
  }, [result]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const response = await fetch(`${API_BASE_URL}/predict-outbreak`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          region_name: formValues.region_name,
          rainfall_mm: parseOptionalNumber(formValues.rainfall_mm),
          temperature_c: parseOptionalNumber(formValues.temperature_c),
          reported_fever_cases: Number(formValues.reported_fever_cases),
        }),
      });

      if (!response.ok) {
        const errorPayload = (await response.json().catch(() => null)) as { detail?: string } | null;
        const message = errorPayload?.detail ?? "Failed to fetch outbreak prediction";
        throw new Error(message);
      }

      const data: OutbreakResponse = await response.json();
      setResult(data);
      onPrediction?.(data);
    } catch (error) {
      setResult(null);
      onPrediction?.(null);
      if (error instanceof Error) {
        setError(error.message);
      } else {
        setError("Prediction service is unreachable. Check NEXT_PUBLIC_API_URL and confirm backend is running.");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-5 shadow-xl backdrop-blur">
      <h2 className="mb-1 text-xl font-semibold tracking-tight text-white">Rural Health Report</h2>
      <p className="mb-5 text-sm text-slate-300">Submit local observations to estimate outbreak risk in real time.</p>

      <form className="space-y-4" onSubmit={handleSubmit}>
        <label className="block text-sm">
          <span className="mb-1 block text-slate-200">Region Name</span>
          <input
            required
            value={formValues.region_name}
            onChange={(event) => setFormValues((prev) => ({ ...prev, region_name: event.target.value }))}
            className="w-full rounded-lg border border-slate-600 bg-slate-950/70 px-3 py-2 text-slate-100 outline-none ring-cyan-300 transition focus:ring-2"
            placeholder="Example: Kajiado South"
          />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-slate-200">Daily Rainfall (mm) - optional</span>
          <input
            min={0}
            step="0.1"
            type="number"
            value={formValues.rainfall_mm}
            onChange={(event) => setFormValues((prev) => ({ ...prev, rainfall_mm: event.target.value }))}
            className="w-full rounded-lg border border-slate-600 bg-slate-950/70 px-3 py-2 text-slate-100 outline-none ring-cyan-300 transition focus:ring-2"
            placeholder="0"
          />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-slate-200">Average Temperature (Celsius) - optional</span>
          <input
            type="number"
            step="0.1"
            value={formValues.temperature_c}
            onChange={(event) => setFormValues((prev) => ({ ...prev, temperature_c: event.target.value }))}
            className="w-full rounded-lg border border-slate-600 bg-slate-950/70 px-3 py-2 text-slate-100 outline-none ring-cyan-300 transition focus:ring-2"
            placeholder="28"
          />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-slate-200">Number of Fever Cases</span>
          <input
            required
            min={0}
            type="number"
            value={formValues.reported_fever_cases}
            onChange={(event) =>
              setFormValues((prev) => ({
                ...prev,
                reported_fever_cases: event.target.value,
              }))
            }
            className="w-full rounded-lg border border-slate-600 bg-slate-950/70 px-3 py-2 text-slate-100 outline-none ring-cyan-300 transition focus:ring-2"
            placeholder="12"
          />
        </label>

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-lg bg-cyan-400 px-4 py-2.5 font-medium text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-cyan-600"
        >
          {isSubmitting ? "Analyzing..." : "Predict Outbreak Risk"}
        </button>
      </form>

      {error ? <p className="mt-4 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p> : null}

      {result ? (
        <div className={`mt-4 rounded-lg border px-4 py-3 ${statusStyles}`}>
          <p className="text-sm">Region: {result.resolved_region_name}</p>
          <p className="text-lg font-semibold">Risk Score: {result.risk_score}/100</p>
          <p className="text-sm font-medium">Status: {result.status}</p>
          <p className="mt-1 text-xs opacity-90">
            Confidence band: {result.confidence_lower.toFixed(1)} to {result.confidence_upper.toFixed(1)}
          </p>
          <p className="mt-1 text-xs opacity-85">
            Weather inputs used: {result.rainfall_mm_used.toFixed(1)} mm rainfall, {result.temperature_c_used.toFixed(1)} C
          </p>
          {result.weather_autofilled ? <p className="text-xs opacity-85">Rainfall and/or temperature were auto-fetched from Open-Meteo.</p> : null}
        </div>
      ) : null}
    </div>
  );
}
