import { OpenMeteoService } from "./openmeteo/OpenMeteoService";
import type { ForecastBundle, GeoPoint, Place, SpotWeather, WeatherSource } from "./weathernext3/types";
import { weatherNext3 } from "./WeatherNext3MockService";

/** What the app asks of a weather source. The radar map layers always come from the simulation. */
export interface WeatherService {
  readonly source: WeatherSource;
  /** Current conditions, the next 48 hours and 15 days for a place. */
  getForecastBundle(place: Place): Promise<ForecastBundle>;
  /**
   * Weather at many points, each at its own time, in one request: the
   * favorites now, or a road trip's stops at the times you reach them.
   */
  getWeatherAlong(stops: { point: GeoPoint; time: string }[]): Promise<SpotWeather[]>;
}

/** Which source the page uses, decided on the server. */
export interface WeatherSetup {
  source: WeatherSource;
  /**
   * Ask Open-Meteo through DooFah's server, which adds the commercial API key
   * (OPEN_METEO_API_KEY) so it never reaches the browser.
   */
  proxy: boolean;
}

const services = new Map<string, WeatherService>();

/** The shared service for a setup, so its caches last as long as the page. */
export function weatherService({ source, proxy }: WeatherSetup): WeatherService {
  if (source === "simulated") return weatherNext3;
  const key = proxy ? "open-meteo+proxy" : "open-meteo";
  let service = services.get(key);
  if (!service) {
    service = new OpenMeteoService({ proxy });
    services.set(key, service);
  }
  return service;
}
