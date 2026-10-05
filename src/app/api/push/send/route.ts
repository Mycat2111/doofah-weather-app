import { pushServer } from "@/services/push/http";

const server = pushServer();

/** ECMWF's storm tracks take a few seconds, then 20 pushes at a time with a 10 s limit each. */
export const maxDuration = 60;

/** The storm alert job, every 30 minutes from GitHub Actions with `Authorization: Bearer <CRON_SECRET>`. */
export function POST(request: Request) {
  return server.sendStorms(request);
}
