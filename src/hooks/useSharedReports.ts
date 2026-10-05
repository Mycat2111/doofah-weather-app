"use client";

import { useMemo, useSyncExternalStore } from "react";
import useSWR from "swr";
import { myReportsStore, type CrowdReport, type ReportKind } from "@/lib/crowdReports";
import {
  mergeTiles,
  othersOf,
  tileKey,
  tilesFor,
  type ReportCell,
  type SharedReport,
  type TileReports,
} from "@/lib/sharedReports";
import type { GeoBounds } from "@/services/weather/types";

/** New reports reach the map about this often (the edge keeps a tile 30 s). */
const REFRESH_MS = 60_000;
/** After a failure, asked again after about this long. */
const RETRY_MS = 60_000;

/** The server has no shared backend (503): the page stops asking until it is reloaded. */
class NotSetUp extends Error {}
let notSetUp = false;

const NONE: TileReports = { reports: [], cells: [] };

async function fetchTiles([, ...keys]: readonly string[]): Promise<TileReports> {
  const answers = await Promise.all(
    keys.map(async (key) => {
      const response = await fetch(`/api/reports?tile=${key}`);
      if (response.status === 503) throw new NotSetUp();
      if (!response.ok) throw new Error(`/api/reports answered ${response.status}`);
      return (await response.json()) as TileReports;
    }),
  );
  return mergeTiles(answers);
}

/**
 * Everyone's weather reports from the last 3 hours in `bounds`, from
 * /api/reports by map tile, asked again every minute. This device's own
 * reports are left out (they show from its storage), and so is everything
 * when `bounds` is null, or the server has no shared backend.
 */
export function useSharedReports(bounds: GeoBounds | null): { others: CrowdReport[]; cells: ReportCell[] } {
  const mine = useSyncExternalStore(
    myReportsStore.subscribe,
    myReportsStore.getSnapshot,
    myReportsStore.getServerSnapshot,
  );
  const key = useMemo(
    () => (bounds && !notSetUp ? ["shared-reports", ...tilesFor(bounds).map(tileKey)] : null),
    [bounds],
  );
  const { data } = useSWR<TileReports, unknown, string[] | null>(key, fetchTiles, {
    refreshInterval: REFRESH_MS,
    keepPreviousData: true,
    revalidateOnFocus: false,
    onErrorRetry: (error, _key, _config, revalidate, { retryCount }) => {
      if (error instanceof NotSetUp) {
        notSetUp = true;
        return;
      }
      window.setTimeout(() => void revalidate({ retryCount }), RETRY_MS);
    },
  });
  const shared = data ?? NONE;
  const others = useMemo(() => othersOf(shared.reports, mine), [shared, mine]);
  return { others, cells: shared.cells };
}

/**
 * Shares a report this device just made. It already shows from the device's
 * storage, so a failure (no shared backend, 6 reports this hour, no
 * network) only means other people don't see it.
 */
export async function shareReport(report: CrowdReport): Promise<SharedReport | null> {
  if (notSetUp) return null;
  const body: { kind: ReportKind; lat: number; lon: number; device: string } = {
    kind: report.kind,
    lat: report.point.lat,
    lon: report.point.lon,
    device: myReportsStore.device(),
  };
  try {
    const response = await fetch("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.status === 503) notSetUp = true;
    if (!response.ok) return null;
    const saved = ((await response.json()) as { report: SharedReport }).report;
    myReportsStore.shared(report.id, saved.id);
    return saved;
  } catch {
    return null;
  }
}
