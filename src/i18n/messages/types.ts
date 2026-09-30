import type {
  AqiCategory,
  DayOutlook,
  NowcastOutlook,
  RadarLayerType,
  WeatherCondition,
} from "@/services/weathernext3/types";

/**
 * Every piece of UI text. Functions take already-formatted values (times,
 * temperatures) so word order can differ between languages.
 */
export interface Messages {
  meta: { title: string; description: string };

  units: {
    kmh: string;
    km: string;
    mm: string;
    mmPerHour: string;
    metres: string;
    microgramsPerCubicMetre: string;
  };

  condition: (condition: WeatherCondition, isDay: boolean) => string;
  aqi: Record<AqiCategory, string>;
  uv: (index: number) => string;
  /** Wind direction name for a bearing in degrees. */
  compass: (degrees: number) => string;
  nowcast: (outlook: NowcastOutlook) => string;
  daySummary: (outlook: DayOutlook) => string;

  header: {
    searchPlaceholder: string;
    searchLabel: string;
    closeSearch: string;
    locate: string;
    locateDenied: string;
    locateUnavailable: string;
    language: string;
  };

  favorites: {
    /** The bar of starred places under the header. */
    label: string;
    /** Shown in the bar before anything is starred. */
    empty: string;
    save: (place: string) => string;
    remove: (place: string) => string;
    editFavorite: (place: string) => string;
    saved: string;
    name: string;
    quickLabels: string;
    home: string;
    office: string;
    removeShort: string;
    edit: string;
    done: string;
  };

  hero: {
    label: string;
    updated: (clock: string) => string;
    /** Text around "5×5 km" in the badge, shown from the `sm` breakpoint up. */
    precisionBefore: string;
    precisionAfter: string;
    cellTitle: (cellId: string) => string;
    feelsLike: (temp: string) => string;
    highLow: (high: string, low: string) => string;
    now: string;
    hoursAhead: (hours: number) => string;
    aqi: string;
  };

  hourly: {
    label: string;
    title: string;
    scrollLabel: string;
    earlier: string;
    later: string;
    now: string;
    sunrise: string;
    sunset: string;
  };

  daily: {
    label: string;
    title: string;
    range: (low: string, high: string) => string;
    nowMarker: (temp: string) => string;
    confidence: (percent: number) => string;
    sparkline: string;
    rain: string;
    wind: string;
    uv: string;
    humidity: string;
    sunrise: string;
    sunset: string;
  };

  details: {
    wind: string;
    windFrom: (direction: string) => string;
    gusts: (speed: string) => string;
    humidity: string;
    dewPoint: (temp: string) => string;
    uvIndex: string;
    pressure: string;
    pressureLow: string;
    pressureHigh: string;
    pressureNormal: string;
    visibility: string;
    cloudCover: (percent: number) => string;
    sun: string;
  };

  radar: {
    label: string;
    layerGroup: string;
    layers: Record<RadarLayerType, { short: string; long: string; legend: string }>;
    loading: string;
    grid: (km: number) => string;
    run: (utcClock: string) => string;
    play: string;
    pause: string;
    mapTime: string;
    now: string;
    offset: (hours: number) => string;
    past: string;
    analysis: string;
    forecast: string;
    outsideArea: string;
    /** Text around the "OpenStreetMap" link in the map credit. */
    attribution: { before: string; after: string };
    probe: {
      noRain: (cloudPercent: number) => string;
      rain: (rate: string) => string;
      temperature: (temp: string) => string;
      wind: (speed: number) => string;
      pressure: (hpa: string) => string;
    };
  };

  errors: {
    forecast: string;
    retry: string;
  };

  footer: {
    credit: string;
    modelRun: (utc: string) => string;
  };
}
