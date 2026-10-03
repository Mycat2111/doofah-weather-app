"use client";

import type { MotionValue } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { useNow } from "@/hooks/useNow";
import { useWeatherState } from "@/hooks/useWeatherState";
import { frameBetween, frameFlow, frameSpan, type Flow } from "@/components/radar/interpolate";
import { floorToHour } from "@/services/weather/time";
import type { GeoBounds, RadarFrame, RadarFrameSet, RadarGridSpec, RadarLayerType } from "@/services/weather/types";

export const TIMELINE_FROM = -3;
export const TIMELINE_TO = 24;
/** The timeline's step: it plays smoothly, but stops, labels and the rest of the dashboard go by 10 minutes. */
export const TIMELINE_STEP_MS = 10 * 60_000;
/** The nearest step to `ms`. */
export const toStep = (ms: number) => Math.round(ms / TIMELINE_STEP_MS) * TIMELINE_STEP_MS;

/** After the layers could not be loaded, they are asked for again after this long, ms. */
const RETRY_MS = 60_000;
/**
 * A new area is asked for once the map has rested this long, ms, so zooming
 * through several levels asks only for the last (each level of the live
 * layers is its own set of points, and every point counts against
 * Open-Meteo's daily limit). The last frames stay on the map meanwhile.
 */
const SETTLE_MS = 500;

interface RadarState {
  key: string;
  data?: RadarFrameSet;
  error?: string;
}

const keyOf = (layer: RadarLayerType, bounds: GeoBounds | null, hour: number) =>
  bounds ? `${layer}:${bounds.flat().join(",")}:${hour}` : "";

/**
 * Hourly frames for one layer over the given area, past 3 h to +24 h, again
 * when the hour turns: from the same source as the forecast (ECMWF when live,
 * the simulation otherwise). Keeps showing the last frame set while a new one
 * comes, waits for the map to rest before asking for a new area, and tries
 * again a minute after a failure.
 */
export function useRadarFrames(layer: RadarLayerType, bounds: GeoBounds | null) {
  const { fields } = useWeatherState();
  const [state, setState] = useState<RadarState>({ key: "" });
  const [attempt, setAttempt] = useState(0);
  const now = useNow();
  const hour = now === null ? 0 : floorToHour(now);
  const key = keyOf(layer, bounds, hour);
  const lastBounds = useRef<GeoBounds | null>(null);

  useEffect(() => {
    if (!bounds || !hour) return;
    let cancelled = false;
    let retry = 0;
    const moved = lastBounds.current !== null && lastBounds.current !== bounds;
    lastBounds.current = bounds;
    const requestKey = keyOf(layer, bounds, hour);
    const load = () =>
      fields
        .getRadarFrames({
          layer,
          bounds,
          fromOffsetHours: TIMELINE_FROM,
          toOffsetHours: TIMELINE_TO,
          maxCellsPerSide: 110,
        })
        .then((data) => !cancelled && setState({ key: requestKey, data }))
        .catch((error: unknown) => {
          if (cancelled) return;
          setState((prev) => ({
            ...prev,
            key: requestKey,
            error: error instanceof Error ? error.message : String(error),
          }));
          retry = window.setTimeout(() => setAttempt((n) => n + 1), RETRY_MS);
        });
    // A new layer, hour or retry loads at once; a new area once the map rests.
    const settle = window.setTimeout(load, moved ? SETTLE_MS : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(settle);
      window.clearTimeout(retry);
    };
  }, [fields, layer, bounds, hour, attempt]);

  return {
    frameSet: state.data,
    loading: state.key !== key,
    error: state.key === key ? state.error : undefined,
  };
}

const times = new WeakMap<RadarFrameSet, number[]>();
const flows = new WeakMap<RadarFrameSet, (Flow | null | undefined)[]>();

function timesOf(set: RadarFrameSet): number[] {
  let list = times.get(set);
  if (!list) {
    list = set.frames.map((frame) => Date.parse(frame.time));
    times.set(set, list);
  }
  return list;
}

/** The motion from frame `i` to the next, worked out once per frame set. */
function flowOf(set: RadarFrameSet, i: number): Flow | null {
  let list = flows.get(set);
  if (!list) {
    list = [];
    flows.set(set, list);
  }
  let flow = list[i];
  if (flow === undefined) {
    flow = frameFlow(set.grid, set.frames[i], set.frames[i + 1]);
    list[i] = flow;
  }
  return flow;
}

/** The frame at `time` (ms): the model's own on the hour, else one made between it and the next. */
export function frameAt(set: RadarFrameSet, time: number): RadarFrame {
  const { index, t } = frameSpan(timesOf(set), time);
  if (t === 0) return set.frames[index];
  return frameBetween(set.frames[index], set.frames[index + 1], t, time, flowOf(set, index));
}

/** Shortest time between two frames made for a moving playhead, ms: about 30 a second. */
const FRAME_MS = 32;
/** Pause between working out the motion of one hour and the next in the background, ms. */
const WARM_PAUSE_MS = 40;

/** The playhead counts as resting this long after it last moved, ms. */
const REST_MS = 200;

export interface ShownFrame {
  grid: RadarGridSpec;
  frame: RadarFrame;
  /** The playhead is moving (playing, scrubbing), so layers may paint quickly rather than finely. */
  moving: boolean;
}

/**
 * The frame at the playhead's time (ms), following it while it moves
 * (playback, scrubbing) up to about 30 times a second. The motion of rain and
 * clouds between hours is worked out in the background, from the playhead's
 * hour on, so playback doesn't stall when it reaches a new hour.
 */
export function useFrameAt(set: RadarFrameSet | undefined, playhead: MotionValue<number>): ShownFrame | undefined {
  const [shown, setShown] = useState<ShownFrame>();

  useEffect(() => {
    if (!set) return;
    let raf = 0;
    let timer = 0;
    let resting = 0;
    let last = -Infinity;
    let moving = false;
    const show = () => {
      raf = 0;
      last = performance.now();
      setShown({ grid: set.grid, frame: frameAt(set, playhead.get()), moving });
    };
    const rest = () => {
      resting = 0;
      moving = false;
      setShown((prev) => (prev && prev.moving ? { ...prev, moving: false } : prev));
    };
    const onChange = () => {
      moving = true;
      window.clearTimeout(resting);
      resting = window.setTimeout(rest, REST_MS);
      request();
    };
    const request = () => {
      if (raf || timer) return;
      const wait = FRAME_MS - (performance.now() - last);
      if (wait <= 0) {
        raf = requestAnimationFrame(show);
      } else {
        timer = window.setTimeout(() => {
          timer = 0;
          raf = requestAnimationFrame(show);
        }, wait);
      }
    };
    request();
    const unsubscribe = playhead.on("change", onChange);

    const pairs = set.frames.length - 1;
    const first = frameSpan(timesOf(set), playhead.get()).index;
    let done = 0;
    let warmer = 0;
    const warm = () => {
      if (done >= pairs) return;
      flowOf(set, (first + done++) % pairs);
      warmer = window.setTimeout(warm, WARM_PAUSE_MS);
    };
    if ((set.layer === "precipitation" || set.layer === "clouds") && pairs > 0)
      warmer = window.setTimeout(warm, WARM_PAUSE_MS);

    return () => {
      unsubscribe();
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      window.clearTimeout(resting);
      window.clearTimeout(warmer);
    };
  }, [set, playhead]);

  return shown;
}
