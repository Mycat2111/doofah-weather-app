import { ForecastService } from "./forecast/ForecastService";
import type { SimulatedWeatherService } from "./simulation/SimulatedWeatherService";
import type {
  AtmosphericSample,
  ForecastBundle,
  GeoPoint,
  Nowcast,
  Place,
  RadarFrameSet,
  RadarLayerType,
  RadarRequest,
  SpotWeather,
  WeatherSource,
} from "./weather/types";

/** What the app asks of a weather source. */
export interface WeatherService {
  readonly source: WeatherSource;
  /** Current conditions, the next 48 hours and 15 days for a place. */
  getForecastBundle(place: Place): Promise<ForecastBundle>;
  /**
   * Weather at many points, each at its own time: the favorites now, or a
   * road trip's stops at the times you reach them.
   */
  getWeatherAlong(stops: { point: GeoPoint; time: string }[]): Promise<SpotWeather[]>;
  /**
   * The map's layers over an area, every hour from 3 hours back to a day
   * ahead: from ECMWF when live (/api/fields), from the simulation otherwise.
   */
  getRadarFrames<L extends RadarLayerType>(request: RadarRequest<L>): Promise<RadarFrameSet<L>>;
  /**
   * The weather at a point at any moment, when the source knows more than its
   * hourly forecast: the simulation, from the model behind its map layers.
   * For the moment picked on the map's timeline.
   */
  momentAt?(point: GeoPoint, time: number): { sample: AtmosphericSample; nowcast: Nowcast } | null;
}

/** Which source the page uses, decided on the server. */
export interface WeatherSetup {
  source: WeatherSource;
  /**
   * Ask Open-Meteo's air quality through DooFah's server, which adds the
   * commercial API key (OPEN_METEO_API_KEY) so it never reaches the browser.
   */
  proxy: boolean;
}

/**
 * The simulation, for `?data=sim`: test and demo data, never mixed with the
 * live forecast. It is loaded the first time it is asked for, so the live
 * app never downloads it.
 */
class SimulationLoader implements WeatherService {
  readonly source = "simulated" as const;
  private simulation: Promise<SimulatedWeatherService> | null = null;
  private loaded: SimulatedWeatherService | null = null;

  private load() {
    this.simulation ??= import("./simulation/SimulatedWeatherService").then(
      ({ weatherSimulation }) => (this.loaded = weatherSimulation),
    );
    return this.simulation;
  }

  async getForecastBundle(place: Place) {
    return (await this.load()).getForecastBundle(place);
  }

  async getWeatherAlong(stops: { point: GeoPoint; time: string }[]) {
    return (await this.load()).getWeatherAlong(stops);
  }

  async getRadarFrames<L extends RadarLayerType>(request: RadarRequest<L>) {
    return (await this.load()).getRadarFrames(request);
  }

  momentAt(point: GeoPoint, time: number) {
    // Loaded by then: there is no forecast to show a moment of until it is.
    const sim = this.loaded;
    return sim && { sample: sim.sampleAt(point, time), nowcast: sim.nowcastAt(point, time) };
  }
}

const simulation = new SimulationLoader();
const services = new Map<string, WeatherService>();

/** The shared service for a setup, so its caches last as long as the page. */
export function weatherService({ source, proxy }: WeatherSetup): WeatherService {
  if (source === "simulated") return simulation;
  const key = proxy ? "live+proxy" : "live";
  let service = services.get(key);
  if (!service) {
    service = new ForecastService({ airProxy: proxy });
    services.set(key, service);
  }
  return service;
}
