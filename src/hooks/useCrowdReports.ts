"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useNow } from "@/hooks/useNow";
import { shareReport, useSharedReports } from "@/hooks/useSharedReports";
import { verifyRadar } from "@/lib/crowdVerify";
import { liveReports, myReportsStore, REPORT_RADIUS_KM, type CrowdReport, type ReportKind } from "@/lib/crowdReports";
import { boundsAround, countNear } from "@/lib/sharedReports";
import type { Place } from "@/services/weather/types";

const REFRESH_MS = 60_000;

interface CommunityState {
  placeId: string;
  reports: CrowdReport[];
  /** What the simulation's model shows at a report's spot and time, to check reports against. */
  radarAt?: (report: CrowdReport) => ReportKind;
}

/**
 * Weather reports from the last 3 hours around `place`: this device's from
 * localStorage, and other people's, refreshed every minute: everyone's from
 * /api/reports with real forecasts, or the simulation's with `simulated`
 * data, with how they compare with its radar.
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
  const near = useMemo(() => (simulated ? null : boundsAround(place.point, REPORT_RADIUS_KM)), [simulated, place]);
  const shared = useSharedReports(near);

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

  const others = simulated ? (community.placeId === place.id ? community.reports : []) : shared.others;
  // Just-sent reports can be a few seconds newer than the shared clock.
  const at = Math.max(now ?? 0, ...mine.map((r) => Date.parse(r.time)));
  const reports = now === null ? [] : liveReports([...mine, ...others], at, place.point);
  // A busy area comes back counted per cell; those people count as nearby too.
  const nearby = countNear(
    reports.filter((r) => !r.mine),
    shared.cells,
    place.point,
    REPORT_RADIUS_KM,
  );

  return {
    reports,
    /** Other people's reports within REPORT_RADIUS_KM, counted ones included. */
    nearby,
    /** This device's latest report around this place, if it is still live. */
    mine: reports.find((r) => r.mine) ?? null,
    verification: simulated && community.radarAt ? verifyRadar(reports, community.radarAt) : null,
    now: at,
    submit: (kind: ReportKind) => {
      const report = myReportsStore.submit(kind, place.point);
      // The simulation's reports stay out of everyone's map.
      if (!simulated) void shareReport(report);
      return report;
    },
  };
}
