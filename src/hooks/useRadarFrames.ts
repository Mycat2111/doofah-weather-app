"use client";

import { useEffect, useState } from "react";
import {
  weatherNext3,
  type GeoBounds,
  type RadarFrameSet,
  type RadarLayerType,
} from "@/services/WeatherNext3MockService";

export const TIMELINE_FROM = -3;
export const TIMELINE_TO = 24;

interface RadarState {
  key: string;
  data?: RadarFrameSet;
  error?: string;
}

const keyOf = (layer: RadarLayerType, bounds: GeoBounds | null) =>
  bounds ? `${layer}:${bounds.flat().join(",")}` : "";

/**
 * Frames for one layer over the given area, past 3 h to +24 h.
 * Keeps showing the last frame set while a new one is computed.
 */
export function useRadarFrames(layer: RadarLayerType, bounds: GeoBounds | null) {
  const [state, setState] = useState<RadarState>({ key: "" });
  const key = keyOf(layer, bounds);

  useEffect(() => {
    if (!bounds) return;
    let cancelled = false;
    const requestKey = keyOf(layer, bounds);
    weatherNext3
      .getRadarFrames({ layer, bounds, fromOffsetHours: TIMELINE_FROM, toOffsetHours: TIMELINE_TO, maxCellsPerSide: 110 })
      .then((data) => !cancelled && setState({ key: requestKey, data }))
      .catch((error: unknown) => {
        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            key: requestKey,
            error: error instanceof Error ? error.message : "Could not load map layer",
          }));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [layer, bounds]);

  return {
    frameSet: state.data,
    loading: state.key !== key,
    error: state.key === key ? state.error : undefined,
  };
}
