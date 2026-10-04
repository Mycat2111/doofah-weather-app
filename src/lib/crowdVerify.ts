import { isRainReport, type CrowdReport, type ReportKind } from "@/lib/crowdReports";

/** At least this many people must agree with the radar to call it verified. */
export const VERIFY_MIN_PEOPLE = 2;
/** ...and at least this share of the local reports. */
export const VERIFY_SHARE = 0.6;

export type VerificationStatus =
  /** Enough local reports agree with the radar. */
  | "verified"
  /** Most local reports disagree with the radar. */
  | "disputed"
  /** Too few reports to say either way. */
  | "few";

export interface Verification {
  status: VerificationStatus;
  /** Reports that agree with the radar at their spot and time. */
  agreeing: number;
  total: number;
}

/**
 * A report agrees with the radar when both say rain or both say dry. Light
 * against heavy rain, or sunny against cloudy, is a matter of opinion; rain
 * against no rain is what the radar is there to get right.
 */
export const agreesWithRadar = (report: CrowdReport, radar: ReportKind) =>
  isRainReport(report.kind) === isRainReport(radar);

/** How the local reports of the last hour compare with the radar; null without reports. */
export function verifyRadar(reports: CrowdReport[], radarAt: (report: CrowdReport) => ReportKind): Verification | null {
  if (reports.length === 0) return null;
  const total = reports.length;
  const agreeing = reports.filter((r) => agreesWithRadar(r, radarAt(r))).length;
  const share = agreeing / total;
  const status: VerificationStatus =
    agreeing >= VERIFY_MIN_PEOPLE && share >= VERIFY_SHARE
      ? "verified"
      : total >= VERIFY_MIN_PEOPLE && share < 0.5
        ? "disputed"
        : "few";
  return { status, agreeing, total };
}
