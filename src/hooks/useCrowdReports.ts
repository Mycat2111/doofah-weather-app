"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useNow } from "@/hooks/useNow";
import { verifyRadar } from "@/lib/crowdVerify";
import {
  crowdReports,
  liveReports,
  myReportsStore,
  type CrowdReport,
  type ReportKind,
} from "@/services/CrowdReportMockService";
import type { Place } from "@/services/WeatherNext3MockService";

const REFRESH_MS = 60_000;

interface CommunityState {
  placeId: string;
  reports: CrowdReport[];
}

/**
 * Weather reports from the last hour around `place`: this device's from
 * localStorage and, with `simulated` data, other people's from the mock
 * backend (refreshed every minute), with how they compare with the radar.
 *
 * With real forecasts there is no backend of other people's reports yet, and
 * the radar they would check is simulated, so only your own reports show.
 */
export function useCrowdReports(place: Place, simulated: boolean) {
  const mine = useSyncExternalStore(
    myReportsStore.subscribe,
    myReportsStore.getSnapshot,
    myReportsStore.getServerSnapshot,
  );
  const [community, setCommunity] = useState<CommunityState>({ placeId: "", reports: [] });
  const [tick, setTick] = useState(0);
  const now = useNow();

  useEffect(() => {
    if (!simulated) return;
    let cancelled = false;
    crowdReports.getCommunityReports(place.point).then((reports) => {
      if (!cancelled) setCommunity({ placeId: place.id, reports });
    });
    return () => {
      cancelled = true;
    };
  }, [place, tick, simulated]);

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), REFRESH_MS);
    return () => window.clearInterval(id);
  }, []);

  const others = simulated && community.placeId === place.id ? community.reports : [];
  // Just-sent reports can be a few seconds newer than the shared clock.
  const at = Math.max(now ?? 0, ...mine.map((r) => Date.parse(r.time)));
  const reports = now === null ? [] : liveReports([...mine, ...others], at, place.point);

  return {
    reports,
    /** This device's latest report around this place, if it is still live. */
    mine: reports.find((r) => r.mine) ?? null,
    verification: simulated ? verifyRadar(reports, (r) => crowdReports.radarAt(r)) : null,
    now: at,
    submit: (kind: ReportKind) => myReportsStore.submit(kind, place.point),
  };
}
