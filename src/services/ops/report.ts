import { after } from "next/server";
import { sendAlert, type Alert } from "./alert";

/** Where a route says something went wrong; tests pass their own. */
export type Report = (alert: Alert) => void;

/** Logs the alert now and sends it once the reply has gone, so no user waits for Discord or LINE. */
export const reportAfterReply: Report = (alert) => {
  console.error(`[${alert.api}] ${alert.kind}: ${alert.message}`);
  try {
    after(() => sendAlert(alert));
  } catch {
    // Outside a request (a script or a test): send it now instead.
    void sendAlert(alert);
  }
};
