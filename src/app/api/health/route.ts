import { healthResponse } from "@/services/ops/health";

/** Each check gives up after 40 s (CHECK_TIMEOUT_MS), so the route answers well within this. */
export const maxDuration = 60;

/** DooFah's sources, checked for the scheduler, which sends `Authorization: Bearer <CRON_SECRET>`; `?test` sends a test alert. */
export function GET(request: Request) {
  return healthResponse(request);
}
