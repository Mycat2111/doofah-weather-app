"use client";

import useSWR from "swr";
import { wxPointPath, type WxPoint } from "@/lib/wxPoint";
import type { GeoPoint } from "@/services/weather/types";

/** A new run arrives every 6 hours; asking every 15 minutes shows it soon after the edge has it. */
const REFRESH_MS = 15 * 60_000;
const REUSE_MS = 5 * 60_000;

/** /api/v2/point refused or failed: 404 no forecast there, 503 not set up, 5xx failed. */
export class WxPointError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "WxPointError";
  }
}

async function fetchPoint(path: string): Promise<WxPoint> {
  const response = await fetch(path);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { reason?: unknown } | null;
    throw new WxPointError(response.status, typeof body?.reason === "string" ? body.reason : response.statusText);
  }
  return (await response.json()) as WxPoint;
}

/** v2's forecast at `point` (null: none asked for). The last place's stays on screen while the next one loads. */
export function useWxPoint(point: GeoPoint | null) {
  const { data, error, isLoading, isValidating, mutate } = useSWR<WxPoint, unknown>(
    point ? wxPointPath(point.lat, point.lon) : null,
    fetchPoint,
    {
      keepPreviousData: true,
      refreshInterval: REFRESH_MS,
      dedupingInterval: REUSE_MS,
      focusThrottleInterval: REUSE_MS,
      // Nothing there, or not set up, won't change by asking again soon.
      shouldRetryOnError: (e: unknown) => !(e instanceof WxPointError) || e.status >= 500,
    },
  );
  return {
    data,
    /** The HTTP status of the last failure (0: no connection), or null. */
    failed: error ? (error instanceof WxPointError ? error.status : 0) : null,
    loading: isLoading,
    updating: isValidating && !isLoading,
    retry: () => void mutate(),
  };
}
