import type {
  AqiCategory,
  DayOutlook,
  NowcastOutlook,
  RadarLayerType,
  RainIntensity,
  WeatherCondition,
} from "@/services/weathernext3/types";
import type { AlertTip } from "@/lib/alerts";
import type { Activity, Level, LifestyleReason } from "@/lib/lifestyle";
import type { ReportKind } from "@/services/CrowdReportMockService";
import type { RouteOutlook, StopRain } from "@/lib/routeWeather";
import type { SummaryContext, SummaryFact } from "@/lib/voiceSummary";
import type { RouteErrorCode, RouteSource } from "@/services/routing/types";

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
  /** Why a lifestyle card got its status. `clock` formats an ISO time for the place. */
  lifestyleReason: (reason: LifestyleReason, clock: (time: string) => string) => string;
  /**
   * The weather along a road trip in one line. `stop` names a stop by its
   * index; `clock` gives its arrival time, formatted for the place.
   */
  routeOutlook: (outlook: RouteOutlook, stop: (index: number) => string, clock: (index: number) => string) => string;
  /** The spoken weather summary, one sentence per fact, worded to be read aloud. */
  voiceSummary: (facts: SummaryFact[], context: SummaryContext) => string[];

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

  /** Banner for storms, likely rain and unhealthy air. Times arrive formatted. */
  alerts: {
    label: string;
    dismiss: string;
    stormNow: string;
    stormFrom: (clock: string) => string;
    stormDetail: (chance: number) => string;
    rainNow: string;
    rainFrom: (clock: string) => string;
    rainDetail: (chance: number, hours: number) => string;
    heavyAtTimes: string;
    /** Headline for bad air; `category` is the already-translated AQI category. */
    air: (category: string) => string;
    airDetail: (aqi: number, pm25: string) => string;
    /** Label for the list of tips. */
    tipsLabel: string;
    tips: Record<AlertTip, string>;
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

  /** The time-to-rain badge on the hero card. Durations and times arrive formatted. */
  countdown: {
    label: string;
    /** "Rain expected in 20 min". */
    rainIn: Record<RainIntensity, (duration: string) => string>;
    /** The countdown reached zero before the next forecast update. */
    startingNow: string;
    raining: Record<RainIntensity, string>;
    startsAt: (clock: string) => string;
    easesIn: (duration: string, clock: string) => string;
    /** When it eases, from the hourly forecast rather than the radar. */
    easesAround: (clock: string) => string;
    easingNow: string;
    noBreak: (hours: number) => string;
    clearFor: (hours: number) => string;
    dryFor: (hours: number) => string;
    rainFrom: (clock: string, chance: number) => string;
    /** `day` is a weekday name, `date` a short date. */
    nextRain: (day: string, date: string) => string;
    nextRainTomorrow: string;
    noRainAhead: string;
    /** Marks a time that comes from the radar nowcast. */
    radar: string;
    duration: (minutes: number) => string;
  };

  /** Quick status cards for everyday plans. */
  lifestyle: {
    title: string;
    activities: Record<Activity, string>;
    status: Record<Activity, Record<Level, string>>;
  };

  /** One-tap weather reports from people nearby. */
  reports: {
    title: string;
    kinds: Record<ReportKind, string>;
    /** "Sunny" after dark. */
    clear: string;
    hint: string;
    thanks: string;
    /** `kind` is an already-translated report name. */
    yours: (kind: string, ago: string) => string;
    ago: (minutes: number) => string;
    nearby: (count: number) => string;
    you: string;
    verified: (people: number) => string;
    disputed: (agreeing: number, total: number) => string;
    few: (count: number) => string;
  };

  /** Weather along a road trip. */
  route: {
    title: string;
    from: string;
    to: string;
    toPlaceholder: string;
    searchPlaceholder: string;
    myLocation: string;
    swap: string;
    clear: string;
    leave: string;
    leaveNow: string;
    leaveIn: (hours: number) => string;
    planning: string;
    hint: string;
    duration: (minutes: number) => string;
    distance: (km: number) => string;
    /** `clock` is an already-formatted time. */
    arrive: (clock: string) => string;
    source: Record<RouteSource, string>;
    borders: (count: number) => string;
    ferry: string;
    /** A stop with no town nearby, named by its distance from the start. */
    km: (km: number) => string;
    advice: Record<"rain" | "heavy" | "storm", string>;
    rain: Record<StopRain, string>;
    chance: (percent: number) => string;
    timeline: string;
    showOnMap: string;
    /** Label for a stop's button: see it on the map at that time. */
    stopOnMap: (name: string, clock: string) => string;
    /** Where the car is at the map's timeline time. */
    carHere: (clock: string) => string;
    errors: Record<RouteErrorCode, string>;
    retry: string;
  };

  /** The spoken weather summary. */
  voice: {
    play: string;
    /** Button label on narrow screens. */
    short: string;
    title: string;
    stop: string;
    replay: string;
    close: string;
    /** The browser has no speech. */
    noSpeech: string;
    /** No voice for the language on this device. */
    noVoice: string;
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
    zoomIn: string;
    zoomOut: string;
    /** The map button that flies to your GPS location. */
    recenter: string;
    /** Shown when one finger drags the map on a touch screen (one finger scrolls the page). */
    twoFingers: string;
    /** Text around the "OpenStreetMap" link in the map credit. */
    attribution: { before: string; after: string };
    /** Tag on the map when the forecast is real but the radar layers are still simulated. */
    simulated: string;
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
    /** No connection: the forecast shown is the one saved at `clock`. */
    offline: (clock: string) => string;
    retry: string;
  };

  footer: {
    /** Credit for the simulated forecast. */
    credit: string;
    modelRun: (utc: string) => string;
    /** Before the "Open-Meteo.com" link, for real forecasts. */
    weatherBy: string;
    /** Before "Copernicus CAMS". */
    airBy: string;
  };
}
