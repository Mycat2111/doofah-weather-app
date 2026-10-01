import { weatherNextServer } from "@/services/weathernext/server";

const server = weatherNextServer();

/**
 * The next 6 hours of rain: Google DeepMind's WeatherNext 3 from BigQuery for
 * the site's owner, Open-Meteo for everyone else and whenever WeatherNext 3
 * can't answer (see src/services/weathernext/server.ts).
 */
export function GET(request: Request) {
  return server.handle(request);
}
