"use client";

import { AnimatePresence, motion } from "framer-motion";
import { LoaderCircle, Radar } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { LayerSwitcher } from "@/components/radar/LayerSwitcher";
import { RadarLegend } from "@/components/radar/RadarLegend";
import { TimelineScrubber } from "@/components/radar/TimelineScrubber";
import { TIMELINE_FROM, TIMELINE_TO, useRadarFrames } from "@/hooks/useRadarFrames";
import { formatClock } from "@/lib/format";
import { snapToGrid, type GeoBounds, type Place, type RadarLayerType } from "@/services/WeatherNext3MockService";

// Leaflet touches `window`, so the map itself only renders in the browser.
const RadarLeafletView = dynamic(() => import("@/components/radar/leaflet/RadarLeafletView"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full w-full place-items-center bg-[#0d1424]">
      <LoaderCircle className="size-6 animate-spin text-white/50" />
    </div>
  ),
});

const NOW_INDEX = -TIMELINE_FROM;
const FRAME_COUNT = TIMELINE_TO - TIMELINE_FROM + 1;
const PLAY_INTERVAL_MS = 650;

/** Snap the view to 0.5° steps so small pans reuse already-computed frames. */
function snapBounds([[s, w], [n, e]]: GeoBounds): GeoBounds {
  const step = 0.5;
  return [
    [Math.floor(s / step) * step, Math.floor(w / step) * step],
    [Math.ceil(n / step) * step, Math.ceil(e / step) * step],
  ];
}

const sameBounds = (a: GeoBounds | null, b: GeoBounds) =>
  !!a && a[0][0] === b[0][0] && a[0][1] === b[0][1] && a[1][0] === b[1][0] && a[1][1] === b[1][1];

interface DooFahRadarMapProps {
  place: Place;
  className?: string;
}

/**
 * Top-view radar: Leaflet + OpenStreetMap base, WeatherNext 3 layers
 * (rain, wind streamlines, temperature, isobars) and a time-lapse scrubber
 * from 3 hours ago to 24 hours ahead.
 */
export function DooFahRadarMap({ place, className = "" }: DooFahRadarMapProps) {
  const [layer, setLayer] = useState<RadarLayerType>("precipitation");
  const [bounds, setBounds] = useState<GeoBounds | null>(null);
  const [frameIndex, setFrameIndex] = useState(NOW_INDEX);
  const [playing, setPlaying] = useState(false);
  const { frameSet, loading } = useRadarFrames(layer, bounds);

  // Time-lapse playback.
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => setFrameIndex((i) => (i + 1) % FRAME_COUNT), PLAY_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [playing]);

  const onViewChange = useCallback((b: GeoBounds) => {
    const snapped = snapBounds(b);
    setBounds((prev) => (sameBounds(prev, snapped) ? prev : snapped));
  }, []);

  const frames = frameSet?.frames ?? [];
  const frame = frames[Math.min(frameIndex, frames.length - 1)];
  const cell = snapToGrid(place.point);

  return (
    <section
      aria-label="Weather radar map"
      className={`glass relative isolate overflow-hidden rounded-[28px] ${className}`}
    >
      <div className="absolute inset-0 z-0">
        <RadarLeafletView
          center={place.point}
          cellBounds={cell.bounds}
          grid={frameSet?.grid}
          frame={frame}
          onViewChange={onViewChange}
        />
      </div>

      {/* Top overlay */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-wrap items-start justify-between gap-2 bg-gradient-to-b from-black/35 to-transparent p-3 sm:p-4">
        <div className="pointer-events-auto">
          <LayerSwitcher value={layer} onChange={setLayer} />
        </div>
        <div className="glass-dark pointer-events-auto flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] text-white/80">
          <AnimatePresence mode="wait" initial={false}>
            {loading ? (
              <motion.span key="l" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <LoaderCircle className="size-3.5 animate-spin text-sky-200" aria-label="Loading layer" />
              </motion.span>
            ) : (
              <motion.span key="r" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <Radar className="size-3.5 text-sky-200" aria-hidden />
              </motion.span>
            )}
          </AnimatePresence>
          <span>
            WeatherNext 3 · {frameSet ? `${frameSet.grid.cellSizeKm} km grid` : "5 km grid"}
            {frameSet && (
              <span className="hidden text-white/50 sm:inline">
                {" "}
                · run {formatClock(frameSet.model.runInitTime, "UTC")} UTC
              </span>
            )}
          </span>
        </div>
      </div>

      {/* Bottom overlay: timeline + legend */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 p-3 sm:p-4">
        <div className="glass-dark pointer-events-auto flex flex-col gap-3 rounded-3xl p-3 sm:flex-row sm:items-center sm:gap-5 sm:p-4">
          <div className="min-w-0 flex-1">
            <TimelineScrubber
              times={frames.map((f) => f.time)}
              offsets={frames.length ? frames.map((f) => f.offsetHours) : [0]}
              index={Math.min(frameIndex, Math.max(0, frames.length - 1))}
              onIndexChange={(i) => {
                setPlaying(false);
                setFrameIndex(i);
              }}
              playing={playing}
              onTogglePlay={() => setPlaying((p) => !p)}
              timeZone={place.timeZone}
              disabled={!frames.length}
            />
          </div>
          <div className="border-white/10 sm:border-l sm:pl-5">
            <RadarLegend layer={layer} />
            <p className="mt-1 text-right text-[9px] text-white/40">
              Map ©{" "}
              <a
                href="https://www.openstreetmap.org/copyright"
                target="_blank"
                rel="noreferrer"
                className="underline decoration-white/30 hover:text-white/70"
              >
                OpenStreetMap
              </a>{" "}
              contributors
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
