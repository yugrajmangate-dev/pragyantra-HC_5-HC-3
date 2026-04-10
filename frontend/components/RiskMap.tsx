"use client";

import { useEffect, useRef } from "react";
import type { OutbreakResponse } from "@/components/ReportForm";

type RiskMapProps = {
  prediction: OutbreakResponse | null;
};

function markerColor(status: OutbreakResponse["status"]): string {
  if (status === "Critical Outbreak Risk") {
    return "#f43f5e";
  }

  if (status === "Warning") {
    return "#f59e0b";
  }

  return "#10b981";
}

export default function RiskMap({ prediction }: RiskMapProps) {
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const activeMarkerRef = useRef<import("leaflet").CircleMarker | null>(null);
  const activeAuraRef = useRef<import("leaflet").Circle | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);

  useEffect(() => {
    let canceled = false;

    async function loadMap() {
      if (!mapElementRef.current) {
        return;
      }

      const L = await import("leaflet");
      if (canceled || !mapElementRef.current) {
        return;
      }

      leafletRef.current = L;

      const map = L.map(mapElementRef.current, {
        zoomControl: true,
      }).setView([-1.8, 37.8], 6);

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);

      mapRef.current = map;
    }

    loadMap();

    return () => {
      canceled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      activeMarkerRef.current = null;
      activeAuraRef.current = null;
      leafletRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!prediction || prediction.latitude === null || prediction.longitude === null) {
      return;
    }

    const map = mapRef.current;
    const L = leafletRef.current;
    if (!map || !L) {
      return;
    }

    if (activeMarkerRef.current) {
      activeMarkerRef.current.remove();
      activeMarkerRef.current = null;
    }

    if (activeAuraRef.current) {
      activeAuraRef.current.remove();
      activeAuraRef.current = null;
    }

    const marker = L.circleMarker([prediction.latitude, prediction.longitude], {
      radius: Math.max(8, Math.floor(prediction.risk_score / 8)),
      color: markerColor(prediction.status),
      fillColor: markerColor(prediction.status),
      fillOpacity: 0.72,
      weight: 3,
    }).addTo(map);

    const aura = L.circle([prediction.latitude, prediction.longitude], {
      radius: Math.max(9000, prediction.risk_score * 210),
      color: markerColor(prediction.status),
      fillColor: markerColor(prediction.status),
      fillOpacity: 0.1,
      weight: 1,
    }).addTo(map);

    marker.bindPopup(
      `<div style="font-size: 12px; line-height: 1.5;"><strong>${prediction.resolved_region_name}</strong><br/>Risk Score: ${prediction.risk_score}/100<br/>Status: ${prediction.status}<br/>Confidence: ${prediction.confidence_lower.toFixed(1)} to ${prediction.confidence_upper.toFixed(1)}</div>`,
    );
    marker.openPopup();

    map.setView([prediction.latitude, prediction.longitude], 8, {
      animate: true,
      duration: 0.7,
    });

    activeMarkerRef.current = marker;
    activeAuraRef.current = aura;
  }, [prediction]);

  useEffect(() => {
    if (!prediction || prediction.latitude !== null || prediction.longitude !== null) {
      return;
    }

    if (activeMarkerRef.current) {
      activeMarkerRef.current.remove();
      activeMarkerRef.current = null;
    }

    if (activeAuraRef.current) {
      activeAuraRef.current.remove();
      activeAuraRef.current = null;
    }
  }, [prediction]);

  return (
    <div className="relative h-full w-full" aria-label="Outbreak risk map">
      <div ref={mapElementRef} className="h-full w-full" />
      {!prediction ? (
        <div className="pointer-events-none absolute left-4 top-4 rounded-lg border border-white/20 bg-slate-950/80 px-3 py-2 text-xs text-slate-200 backdrop-blur">
          Submit a report to place a live risk pin.
        </div>
      ) : null}
      {prediction && (prediction.latitude === null || prediction.longitude === null) ? (
        <div className="pointer-events-none absolute left-4 top-4 rounded-lg border border-amber-300/40 bg-slate-950/85 px-3 py-2 text-xs text-amber-100 backdrop-blur">
          Region could not be geocoded. Pin unavailable for this submission.
        </div>
      ) : null}
    </div>
  );
}
