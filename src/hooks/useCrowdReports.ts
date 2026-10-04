"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useNow } from "@/hooks/useNow";
import { verifyRadar } from "@/lib/crowdVerify";
import { liveReports, myReportsStore, type CrowdReport, type ReportKind } from "@/lib/crowdReports";
import type { Place } from "@/services/weather/types";

const REFRESH_MS = 60_000;

interface CommunityState {
  placeId: string;
  reports: CrowdReport[];
  /** What the simulation's model shows at a report's spot and time, to check reports against. */
  radarAt?: (report: CrowdReport) => ReportKind;
}

/**
 * Weather reports from the last hour around `place`: this device's from
 * localStorage and, with `simulated` data, other people's from the
 * simulation (refreshed every minute), with how they compare with its radar.
 *
 * With real forecasts there is no backend of other people's reports yet, so
 * only your own reports show.
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
    // Only the simulation has other people's reports, so only `?data=sim` loads it.
    import("@/services/simulation/SimulatedCrowdReports").then(async ({ crowdSimulation }) => {
      const reports = await crowdSimulation.getCommunityReports(place.point);
      if (!cancelled) setCommunity({ placeId: place.id, reports, radarAt: (r) => crowdSimulation.radarAt(r) });
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
    verification: simulated && community.radarAt ? verifyRadar(reports, community.radarAt) : null,
    now: at,
    submit: (kind: ReportKind) => myReportsStore.submit(kind, place.point),
  };
}
