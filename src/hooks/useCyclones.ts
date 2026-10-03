"use client";

import { useEffect, useMemo, useState } from "react";
import { useNow } from "@/hooks/useNow";
import { demoCyclones } from "@/lib/cycloneDemo";
import type { CycloneFeed, GeoPoint } from "@/lib/cyclones";

/** ECMWF adds a run every 6 hours and the server keeps an answer half an hour, so ask again after that. */
const REFRESH_MS = 30 * 60_000;
/** After a failure, ask again after this long; the last storms stay on screen meanwhile. */
const RETRY_MS = 60_000;
const HOUR_MS = 3_600_000;

export interface CycloneState {
  /** The storms; null until the first answer. */
  feed: CycloneFeed | null;
  loading: boolean;
  /** The last request failed (a retry is on its way). */
  error: boolean;
}

/**
 * The active tropical cyclones from /api/cyclones, kept fresh. With `demo`
 * (from `?cyclones=demo`), a made-up storm near that point instead.
 */
export function useCyclones(demo: GeoPoint | null): CycloneState {
  const [state, setState] = useState<{ feed: CycloneFeed | null; error: boolean }>({ feed: null, error: false });
  const [attempt, setAttempt] = useState(0);
  const live = demo === null;

  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    const controller = new AbortController();
    fetch("/api/cyclones", { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const feed = (await res.json()) as CycloneFeed;
        if (!Array.isArray(feed?.storms)) throw new Error("Not a cyclone list");
        return feed;
      })
      .then((feed) => {
        if (!cancelled) setState({ feed, error: false });
      })
      .catch(() => {
        if (!cancelled) setState((s) => ({ feed: s.feed, error: true }));
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [live, attempt]);

  useEffect(() => {
    if (!live) return;
    const timer = window.setTimeout(() => setAttempt((a) => a + 1), state.error ? RETRY_MS : REFRESH_MS);
    return () => window.clearTimeout(timer);
  }, [live, state]);

  // The sample storm moves on once an hour, like a new forecast would.
  const now = useNow();
  const hour = now === null ? null : Math.floor(now / HOUR_MS);
  const lat = demo?.lat;
  const lon = demo?.lon;
  const demoFeed = useMemo(
    () => (lat !== undefined && lon !== undefined && hour !== null ? demoCyclones({ lat, lon }, hour * HOUR_MS) : null),
    [lat, lon, hour],
  );

  if (!live) return { feed: demoFeed, loading: demoFeed === null, error: false };
  return { feed: state.feed, loading: state.feed === null && !state.error, error: state.error };
}
