"use client";

import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  type AnimationPlaybackControls,
} from "framer-motion";
import type { Map as LeafletMap } from "leaflet";
import { Hand, LoaderCircle, Radar } from "lucide-react";
import dynamic from "next/dynamic";
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CrowdVerifiedBadge } from "@/components/radar/CrowdVerifiedBadge";
import { CycloneStatus } from "@/components/radar/CycloneStatus";
import { LayerSwitcher } from "@/components/radar/LayerSwitcher";
import { RadarLegend } from "@/components/radar/RadarLegend";
import { RecenterButton } from "@/components/radar/RecenterButton";
import { TimelineScrubber } from "@/components/radar/TimelineScrubber";
import { ZoomButtons } from "@/components/radar/ZoomButtons";
import type { CycloneState } from "@/hooks/useCyclones";
import { useNow } from "@/hooks/useNow";
import { TIMELINE_STEP_MS, toStep, useRadarFrames } from "@/hooks/useRadarFrames";
import { useWeatherState } from "@/hooks/useWeatherState";
import { useI18n } from "@/i18n/I18nProvider";
import { placeLabel } from "@/i18n/places";
import { inRegion, lonShift, trackAhead, type Cyclone } from "@/lib/cyclones";
import type { RouteFocus } from "@/components/radar/leaflet/RouteLayer";
import type { Trip } from "@/hooks/useRouteWeather";
import type { Verification } from "@/lib/crowdVerify";
import type { CrowdReport } from "@/lib/crowdReports";
import type { GeoBounds, GeoPoint, Place, RadarLayerType, WeatherSource } from "@/services/weather/types";

// Leaflet touches `window`, so the map itself only renders in the browser.
const RadarLeafletView = dynamic(() => import("@/components/radar/leaflet/RadarLeafletView"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full w-full place-items-center bg-[#0d1424]">
      <LoaderCircle className="size-6 animate-spin text-white/50" />
    </div>
  ),
});

const HOUR_MS = 3_600_000;
/** Forecast time played per millisecond: an hour a second. */
const PLAY_RATE = HOUR_MS / 1000;
/** Playback rests on the last frame this long before starting over, ms. */
const END_HOLD_MS = 800;
/** Gliding to a time picked by a tap, a key or "Back to now". */
const GLIDE = { duration: 0.6, ease: [0.22, 1, 0.36, 1] as const };

/**
 * Snap the view outwards so small pans reuse already-computed frames: to 0.5°
 * close in, coarser the wider the view (16° when the map shows a whole region).
 */
function snapBounds([[s, w], [n, e]]: GeoBounds): GeoBounds {
  const step = Math.max(0.5, 2 ** Math.floor(Math.log2(Math.max(n - s, e - w) / 8)));
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
  /**
   * Where the dashboard's forecast and the map's layers come from: ECMWF
   * (/api/fields) when live, the simulation with `?data=sim`.
   */
  source?: WeatherSource;
  /** A planned road trip to draw over the radar, and requests to show it. */
  trip?: Trip | null;
  tripFocus?: RouteFocus;
  tripStopName?: (index: number) => string;
  /** Active tropical cyclones, and requests to show one (from the storm alert). */
  cyclones?: CycloneState;
  stormFocus?: StormFocus;
  className?: string;
}

export interface StormFocus {
  /** Changes each time the dashboard asks the map to show a storm. */
  key: number;
  stormId: string;
}

/**
 * Top-view radar: Leaflet + OpenStreetMap base, the model's layers (rain,
 * cloud cover, wind streamlines, temperature, isobars) and a time-lapse
 * scrubber from 3 hours ago to 24 hours ahead. The timeline plays smoothly
 * between the hourly frames (rain and cloud move along their tracks) and
 * stops on 10-minute steps; the rest of the dashboard follows its time.
 */
export function DooFahRadarMap({
  place,
  onLocated,
  reports = [],
  reportsNow = 0,
  verification = null,
  night = false,
  source = "simulated",
  trip = null,
  tripFocus,
  tripStopName,
  cyclones,
  stormFocus,
  className = "",
}: DooFahRadarMapProps) {
  const { m, f, locale } = useI18n();
  const [layer, setLayer] = useState<RadarLayerType>("precipitation");
  const [bounds, setBounds] = useState<GeoBounds | null>(null);
  const [map, setMap] = useState<LeafletMap | null>(null);
  const [gestureHint, setGestureHint] = useState(false);
  const nextZoomRef = useRef<number | null>(null);
  const { frameSet, loading, error } = useRadarFrames(layer, bounds);
  const { time, setTime, followMap, seek } = useWeatherState();
  const now = useNow();
  const reduceMotion = useReducedMotion();

  // The map's time, ms: it moves smoothly while playing, and every screen
  // follows its 10-minute step (`time`, null for now).
  const playhead = useMotionValue(0);
  const glide = useRef<{ to: number; controls: AnimationPlaybackControls } | null>(null);
  // Playback runs until anything else picks a time (a new seek).
  const [playingFrom, setPlayingFrom] = useState<number | null>(null);
  const playing = playingFrom === seek.key;

  const range = useMemo(() => {
    const frames = frameSet?.frames;
    if (!frames?.length) return null;
    return { start: Date.parse(frames[0].time), end: Date.parse(frames[frames.length - 1].time) };
  }, [frameSet]);
  const hours = useMemo(
    () => frameSet?.frames.map((fr) => ({ time: Date.parse(fr.time), offset: fr.offsetHours })) ?? [],
    [frameSet],
  );
  const rangeStart = range?.start;
  const rangeEnd = range?.end;
  const nowStep = now === null ? null : toStep(now);
  const shown = time ?? nowStep;

  /** Move the playhead to `to`: straight there, or gliding so the weather visibly moves. */
  const moveTo = useCallback(
    (to: number, how: "set" | "glide") => {
      if (glide.current?.to === to) return;
      glide.current?.controls.stop();
      glide.current = null;
      const from = playhead.get();
      // Never glide in from nowhere (the first placement) or for less than a step.
      if (how === "set" || reduceMotion || from === 0 || Math.abs(to - from) <= TIMELINE_STEP_MS) {
        playhead.set(to);
        return;
      }
      const controls = animate(playhead, to, {
        ...GLIDE,
        onComplete: () => {
          if (glide.current?.controls === controls) glide.current = null;
        },
      });
      glide.current = { to, controls };
    },
    [playhead, reduceMotion],
  );

  // Not playing, the playhead rests on the time every screen shows (now
  // until another is picked), and goes there when it changes.
  useEffect(() => {
    if (playing || shown === null || rangeStart === undefined || rangeEnd === undefined) return;
    moveTo(Math.min(rangeEnd, Math.max(rangeStart, shown)), "glide");
  }, [playing, shown, rangeStart, rangeEnd, moveTo]);

  // Playback: an hour a second, resting on the last frame before starting over.
  useEffect(() => {
    if (!playing || rangeStart === undefined || rangeEnd === undefined) return;
    glide.current?.controls.stop();
    glide.current = null;
    if (playhead.get() >= rangeEnd - TIMELINE_STEP_MS / 2) playhead.set(rangeStart);
    let raf = 0;
    let last = performance.now();
    let restUntil = 0;
    let step: number | null = null;
    const frame = (ts: number) => {
      raf = requestAnimationFrame(frame);
      // A hidden tab pauses animation frames; carry on from where it was.
      const dt = Math.min(100, ts - last);
      last = ts;
      if (restUntil) {
        if (ts < restUntil) return;
        restUntil = 0;
        playhead.set(rangeStart);
      } else {
        const next = playhead.get() + dt * PLAY_RATE;
        if (next >= rangeEnd) restUntil = ts + END_HOLD_MS;
        playhead.set(Math.min(rangeEnd, next));
      }
      const at = toStep(playhead.get());
      if (at !== step) {
        step = at;
        // The rest of the dashboard draws in the background, so it never holds up the map.
        startTransition(() => followMap(at === toStep(Date.now()) ? null : at));
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [playing, rangeStart, rangeEnd, playhead, followMap]);

  const togglePlay = () => {
    if (!playing) {
      setPlayingFrom(seek.key);
      return;
    }
    // Stop on the step it is at, so the dashboard and the map agree at once.
    const at = toStep(playhead.get());
    setPlayingFrom(null);
    followMap(at === nowStep ? null : at);
  };

  /** The scrubber picked a time: a finger drags the map straight there, a tap or key glides. */
  const onSeek = (to: number, how: "drag" | "jump") => {
    setPlayingFrom(null);
    moveTo(to, how === "drag" ? "set" : "glide");
    followMap(to === nowStep ? null : to);
  };

  const onViewChange = useCallback((b: GeoBounds) => {
    const snapped = snapBounds(b);
    setBounds((prev) => (sameBounds(prev, snapped) ? prev : snapped));
  }, []);

  // Showing the trip moves the timeline (and every screen) to when you set off, or to when you
  // reach the chosen stop, so the radar shows the rain you would drive into.
  const seenFocus = useRef(tripFocus?.key ?? 0);
  useEffect(() => {
    if (!tripFocus || tripFocus.key === seenFocus.current) return;
    seenFocus.current = tripFocus.key;
    const stop = trip && tripFocus.stop !== null ? trip.stops[tripFocus.stop] : null;
    const when = stop ? Date.parse(stop.eta) : trip ? Date.parse(trip.route.departure) : null;
    if (when !== null) setTime(toStep(when));
  }, [tripFocus, trip, setTime]);

  // Reports describe the last hour, so they show on the timeline's last hour up to now.
  const live = shown === null || nowStep === null || (shown <= nowStep && shown > nowStep - HOUR_MS);

  // Tropical cyclones: every active storm is drawn; the ones whose path or cone comes near the place
  // are listed, and turn the tracks on by themselves until the toggle is used. Asking to see a storm
  // from its alert turns them on again.
  const feed = cyclones?.feed ?? null;
  const storms = useMemo(
    () => (nowStep === null || !feed ? [] : feed.storms.filter((s) => trackAhead(s.track, nowStep).length > 1)),
    [feed, nowStep],
  );
  const nearby = useMemo(
    () => (nowStep === null ? [] : storms.filter((s) => inRegion(s, place.point, nowStep))),
    [storms, place.point, nowStep],
  );
  const focusKey = stormFocus?.key ?? 0;
  const [stormsChoice, setStormsChoice] = useState<{ on: boolean; focusKey: number } | null>(null);
  const stormsOn =
    stormsChoice && stormsChoice.focusKey === focusKey ? stormsChoice.on : nearby.length > 0 || focusKey > 0;

  const showStorm = useCallback(
    (storm: Cyclone) => {
      if (!map || nowStep === null) return;
      const shift = lonShift(storm.track[0].lon, place.point.lon);
      const points = [
        ...trackAhead(storm.track, nowStep).map((p) => [p.lat, p.lon - shift]),
        [place.point.lat, place.point.lon],
      ];
      const lats = points.map((p) => p[0]);
      const lons = points.map((p) => p[1]);
      map.flyToBounds(
        [
          [Math.min(...lats), Math.min(...lons)],
          [Math.max(...lats), Math.max(...lons)],
        ],
        // Room for the storm's name to the right of its eye, and for the controls above and below.
        { paddingTopLeft: [40, 120], paddingBottomRight: [80, 190], duration: 1.2, maxZoom: 7 },
      );
    },
    [map, nowStep, place.point],
  );

  const seenStormFocus = useRef(focusKey);
  useEffect(() => {
    if (!stormFocus || stormFocus.key === seenStormFocus.current) return;
    const storm = storms.find((s) => s.id === stormFocus.stormId);
    if (!storm || !map) return;
    seenStormFocus.current = stormFocus.key;
    showStorm(storm);
  }, [stormFocus, storms, map, showStorm]);

  return (
    <section
      id="doofah-radar"
      aria-label={m.radar.label}
      className={`glass relative isolate scroll-mt-4 overflow-hidden rounded-[28px] ${className}`}
    >
      <div className="absolute inset-0 z-0">
        <RadarLeafletView
          center={place.point}
          frameSet={frameSet}
          playhead={playhead}
          time={shown}
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
          cyclones={
            stormsOn && nowStep !== null
              ? {
                  storms,
                  now: nowStep,
                  placeName: placeLabel(place, locale).name,
                  run: feed?.run ?? null,
                  demo: feed?.demo,
                }
              : undefined
          }
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
      <div className="@container pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-wrap items-start justify-between gap-2 bg-gradient-to-b from-black/35 to-transparent p-3 sm:p-4">
        <div className="flex min-w-0 flex-col items-start gap-2">
          <div className="pointer-events-auto max-w-full">
            <LayerSwitcher
              value={layer}
              onChange={setLayer}
              storms={
                cyclones && {
                  on: stormsOn,
                  near: nearby.length,
                  onToggle: () => setStormsChoice({ on: !stormsOn, focusKey }),
                }
              }
            />
          </div>
          {cyclones && stormsOn && nowStep !== null && (
            <CycloneStatus
              state={cyclones}
              nearby={nearby}
              elsewhere={storms.length - nearby.length}
              place={place.point}
              now={nowStep}
              onPick={showStorm}
            />
          )}
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
          {error ? (
            <span role="status">{m.radar.unavailable}</span>
          ) : (
            <span>
              {source === "simulated" ? m.radar.simulation : "ECMWF"}
              {frameSet && ` · ${m.radar.grid(frameSet.grid.cellSizeKm)}`}
              {frameSet?.model.runInitTime && (
                <span className="hidden text-white/50 sm:inline">
                  {" · "}
                  {m.radar.run(f.clock(frameSet.model.runInitTime, "UTC"))}
                </span>
              )}
            </span>
          )}
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
              start={range?.start ?? 0}
              end={range?.end ?? 1}
              hours={hours}
              now={now}
              time={range ? shown : null}
              playhead={playhead}
              onSeek={onSeek}
              playing={playing}
              onTogglePlay={togglePlay}
              timeZone={place.timeZone}
              disabled={!range}
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
              {stormsOn && feed && (
                <>
                  <br />
                  {m.cyclones.credit.before}
                  <a
                    href="https://www.ecmwf.int/en/forecasts/datasets/open-data"
                    target="_blank"
                    rel="noreferrer"
                    className="underline decoration-white/30 hover:text-white/70"
                  >
                    ECMWF
                  </a>
                  {m.cyclones.credit.after}
                </>
              )}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
