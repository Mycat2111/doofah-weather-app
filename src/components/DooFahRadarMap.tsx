"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { Map as LeafletMap } from "leaflet";
import { Hand, LoaderCircle, Radar } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { CrowdVerifiedBadge } from "@/components/radar/CrowdVerifiedBadge";
import { LayerSwitcher } from "@/components/radar/LayerSwitcher";
import { RadarLegend } from "@/components/radar/RadarLegend";
import { RecenterButton } from "@/components/radar/RecenterButton";
import { TimelineScrubber } from "@/components/radar/TimelineScrubber";
import { ZoomButtons } from "@/components/radar/ZoomButtons";
import { TIMELINE_FROM, TIMELINE_TO, useRadarFrames } from "@/hooks/useRadarFrames";
import { useI18n } from "@/i18n/I18nProvider";
import type { RouteFocus } from "@/components/radar/leaflet/RouteLayer";
import type { Trip } from "@/hooks/useRouteWeather";
import type { Verification } from "@/lib/crowdVerify";
import type { CrowdReport } from "@/services/CrowdReportMockService";
import type { GeoBounds, GeoPoint, Place, RadarLayerType } from "@/services/WeatherNext3MockService";

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
  /** Makes a GPS fix the dashboard's place ("go to my location" on the map). */
  onLocated: (point: GeoPoint) => void;
  /** People's weather reports from the last hour, and how they compare with the radar. */
  reports?: CrowdReport[];
  reportsNow?: number;
  verification?: Verification | null;
  /** Night at the place. */
  night?: boolean;
  /** A planned road trip to draw over the radar, and requests to show it. */
  trip?: Trip | null;
  tripFocus?: RouteFocus;
  tripStopName?: (index: number) => string;
  className?: string;
}

/**
 * Top-view radar: Leaflet + OpenStreetMap base, WeatherNext 3 layers
 * (rain, wind streamlines, temperature, isobars) and a time-lapse scrubber
 * from 3 hours ago to 24 hours ahead.
 */
export function DooFahRadarMap({
  place,
  onLocated,
  reports = [],
  reportsNow = 0,
  verification = null,
  night = false,
  trip = null,
  tripFocus,
  tripStopName,
  className = "",
}: DooFahRadarMapProps) {
  const { m, f } = useI18n();
  const [layer, setLayer] = useState<RadarLayerType>("precipitation");
  const [bounds, setBounds] = useState<GeoBounds | null>(null);
  const [frameIndex, setFrameIndex] = useState(NOW_INDEX);
  const [playing, setPlaying] = useState(false);
  const [map, setMap] = useState<LeafletMap | null>(null);
  const [gestureHint, setGestureHint] = useState(false);
  const nextZoomRef = useRef<number | null>(null);
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

  // Showing the trip moves the timeline to when you set off, or to when you reach the chosen stop,
  // so the radar shows the rain you would drive into.
  const [seenFocus, setSeenFocus] = useState(tripFocus?.key ?? 0);
  if (tripFocus && tripFocus.key !== seenFocus) {
    setSeenFocus(tripFocus.key);
    const stop = trip && tripFocus.stop !== null ? trip.stops[tripFocus.stop] : null;
    const when = stop ? Date.parse(stop.eta) : trip ? Date.parse(trip.route.departure) : null;
    if (when !== null && frames.length) {
      let nearest = 0;
      frames.forEach((fr, i) => {
        if (Math.abs(Date.parse(fr.time) - when) < Math.abs(Date.parse(frames[nearest].time) - when)) nearest = i;
      });
      setPlaying(false);
      setFrameIndex(nearest);
    }
  }

  const frame = frames[Math.min(frameIndex, frames.length - 1)];
  // Reports describe the last hour, so they show on the "now" frames only.
  const live = !frame || (frame.offsetHours <= 0 && frame.offsetHours >= -1);

  return (
    <section
      id="doofah-radar"
      aria-label={m.radar.label}
      className={`glass relative isolate scroll-mt-4 overflow-hidden rounded-[28px] ${className}`}
    >
      <div className="absolute inset-0 z-0">
        <RadarLeafletView
          center={place.point}
          grid={frameSet?.grid}
          frame={frame}
          onViewChange={onViewChange}
          onMap={setMap}
          onGestureHint={setGestureHint}
          nextZoomRef={nextZoomRef}
          reports={live ? reports : undefined}
          reportsNow={reportsNow}
          night={night}
          trip={trip}
          tripFocus={tripFocus}
          tripStopName={tripStopName}
          timeZone={place.timeZone}
        />
      </div>

      {/* One finger scrolls the page on touch screens; say how to move the map. */}
      <AnimatePresence>
        {gestureHint && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="pointer-events-none absolute inset-0 z-20 grid place-items-center bg-black/45 p-6"
          >
            <motion.p
              initial={{ scale: 0.92 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.96 }}
              className="glass-dark flex items-center gap-2.5 rounded-full px-4 py-2.5 text-sm font-medium"
            >
              <Hand className="size-4 shrink-0 text-sky-200" aria-hidden />
              {m.radar.twoFingers}
            </motion.p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top overlay */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-wrap items-start justify-between gap-2 bg-gradient-to-b from-black/35 to-transparent p-3 sm:p-4">
        <div className="flex min-w-0 flex-col items-start gap-2">
          <div className="pointer-events-auto max-w-full">
            <LayerSwitcher value={layer} onChange={setLayer} />
          </div>
          <CrowdVerifiedBadge verification={live && layer === "precipitation" ? verification : null} />
        </div>
        <div className="glass-dark pointer-events-auto flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] text-white/80">
          <AnimatePresence mode="wait" initial={false}>
            {loading ? (
              <motion.span key="l" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <LoaderCircle className="size-3.5 animate-spin text-sky-200" aria-label={m.radar.loading} />
              </motion.span>
            ) : (
              <motion.span key="r" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <Radar className="size-3.5 text-sky-200" aria-hidden />
              </motion.span>
            )}
          </AnimatePresence>
          <span>
            WeatherNext 3 · {m.radar.grid(frameSet?.grid.cellSizeKm ?? 5)}
            {frameSet && (
              <span className="hidden text-white/50 sm:inline">
                {" · "}
                {m.radar.run(f.clock(frameSet.model.runInitTime, "UTC"))}
              </span>
            )}
          </span>
        </div>
      </div>

      <div className="absolute right-3 top-[74px] z-10 flex flex-col items-center gap-2 sm:right-4">
        <ZoomButtons map={map} />
        <RecenterButton map={map} current={place.point} onLocated={onLocated} nextZoomRef={nextZoomRef} />
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
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={layer}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.16 }}
              >
                <RadarLegend layer={layer} />
              </motion.div>
            </AnimatePresence>
            <p className="mt-1 text-right text-[9px] text-white/40 th:text-[10px]">
              {m.radar.attribution.before}
              <a
                href="https://www.openstreetmap.org/copyright"
                target="_blank"
                rel="noreferrer"
                className="underline decoration-white/30 hover:text-white/70"
              >
                OpenStreetMap
              </a>
              {m.radar.attribution.after}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
