import { weatherNextServer } from "@/services/weathernext/server";

const server = weatherNextServer();

/**
 * Opens WeatherNext 3 on this browser: /api/weathernext/access?token=<WEATHERNEXT_OWNER_TOKEN>
 * sets the owner's cookie and returns to the dashboard; ?off removes it.
 */
export function GET(request: Request) {
  return server.access(request);
}
