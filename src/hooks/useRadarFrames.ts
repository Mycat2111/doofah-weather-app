"use client";

import type { MotionValue } from "framer-motion";
import { useEffect, useState } from "react";
import { useNow } from "@/hooks/useNow";
import { frameBetween, frameFlow, frameSpan, type Flow } from "@/components/radar/interpolate";
import { floorToHour } from "@/services/weathernext3/time";
import {
  weatherNext3,
  type GeoBounds,
  type RadarFrame,
  type RadarFrameSet,
  type RadarGridSpec,
  type RadarLayerType,
} from "@/services/WeatherNext3MockService";

export const TIMELINE_FROM = -3;
export const TIMELINE_TO = 24;
/** The timeline's step: it plays smoothly, but stops, labels and the rest of the dashboard go by 10 minutes. */
export const TIMELINE_STEP_MS = 10 * 60_000;
/** The nearest step to `ms`. */
export const toStep = (ms: number) => Math.round(ms / TIMELINE_STEP_MS) * TIMELINE_STEP_MS;

interface RadarState {
  key: string;
  data?: RadarFrameSet;
  error?: string;
}

const keyOf = (layer: RadarLayerType, bounds: GeoBounds | null, hour: number) =>
  bounds ? `${layer}:${bounds.flat().join(",")}:${hour}` : "";

/**
 * Hourly frames for one layer over the given area, past 3 h to +24 h, again
 * when the hour turns. Keeps showing the last frame set while a new one is
 * computed.
 */
export function useRadarFrames(layer: RadarLayerType, bounds: GeoBounds | null) {
  const [state, setState] = useState<RadarState>({ key: "" });
  const now = useNow();
  const hour = now === null ? 0 : floorToHour(now);
  const key = keyOf(layer, bounds, hour);

  useEffect(() => {
    if (!bounds || !hour) return;
    let cancelled = false;
    const requestKey = keyOf(layer, bounds, hour);
    weatherNext3
      .getRadarFrames({
        layer,
        bounds,
        fromOffsetHours: TIMELINE_FROM,
        toOffsetHours: TIMELINE_TO,
        maxCellsPerSide: 110,
      })
      .then((data) => !cancelled && setState({ key: requestKey, data }))
      .catch((error: unknown) => {
        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            key: requestKey,
            error: error instanceof Error ? error.message : String(error),
          }));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [layer, bounds, hour]);

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
 * (playback, scrubbing) up to about 30 times a second. The rain's motion
 * between hours is worked out in the background, from the playhead's hour
 * on, so playback doesn't stall when it reaches a new hour.
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
    if (set.layer === "precipitation" && pairs > 0) warmer = window.setTimeout(warm, WARM_PAUSE_MS);

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
