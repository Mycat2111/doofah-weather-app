import type { ReportKind } from "@/lib/crowdReports";
import type {
  AqiCategory,
  DayOutlook,
  NowcastOutlook,
  RadarLayerType,
  RainIntensity,
  WeatherCondition,
} from "@/services/weather/types";
import type { AlertTip } from "@/lib/alerts";
import type { CycloneCategory } from "@/lib/cyclones";
import type { Activity, Level, LifestyleReason } from "@/lib/lifestyle";
import type { RouteOutlook, StopRain } from "@/lib/routeWeather";
import type { SummaryContext, SummaryFact } from "@/lib/voiceSummary";
import type { RouteErrorCode } from "@/services/routing/types";
import type { ModelUsed } from "@/services/forecast/types";

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

  /** The weather model behind a live forecast's hour or day (its tag shows the model's name as it is). */
  forecastModel: {
    /** Before the model in a tooltip or a line, e.g. "Forecast model". */
    label: string;
    /** Before the model in the weather card's tag tooltip, e.g. "This hour's forecast". */
    thisHour: string;
    /** Who runs it and how fine it is, e.g. "ECMWF's IFS, 9 km". */
    about: Record<ModelUsed, string>;
  };

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
    /** A tropical cyclone's path coming near a place; `storm` is already named ("Typhoon IN-FA"). */
    cyclone: {
      near: (storm: string, km: number, place: string) => string;
      /** It is that close already. */
      already: (storm: string, km: number, place: string) => string;
      /** `when` from cyclones.when, or null when it is close now; the share of ECMWF's forecasts within `alertKm`. */
      detail: (when: string | null, windKmh: number | null, chance: number | null, alertKm: number) => string;
      also: (places: string, alertKm: number) => string;
      showOnMap: string;
    };
  };

  hero: {
    label: string;
    updated: (clock: string) => string;
    /**
     * The card shows the forecast for a moment picked on the map's timeline.
     * `day` counts days from today (0 today, 1 tomorrow); `weekday` names it.
     */
    forecastFor: (clock: string, day: number, weekday: string) => string;
    backToNow: string;
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
    /** Live forecasts: rain likely within 2 hours, by its hour (or this hour). */
    likelyAround: (clock: string) => string;
    likelyNow: string;
    /** Rain in the forecast with less than an even chance: within 2 hours, then after them. */
    possibleAround: (clock: string) => string;
    possibleNow: string;
    possibleFrom: (clock: string, chance: number) => string;
    /** Under rain within 2 hours: its chance. */
    chance: (chance: number) => string;
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
    /** A car ferry on the way, with its time on board. */
    ferry: (minutes: number) => string;
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
    /** Credits under the trip: "Route by OSRM · Road data © OpenStreetMap contributors (ODbL) · Report a map error". */
    routeBy: string;
    /** Text around "OpenStreetMap". */
    roadCredit: { before: string; after: string };
    fixMap: string;
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
    /** Under the summary while Google's AI voice reads it (says the voice is synthetic). */
    aiVoice: string;
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
    /** The simulation's model confidence. */
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
    /** `?data=sim`: the layers' source, where live layers name their model. */
    simulation: string;
    run: (utcClock: string) => string;
    play: string;
    pause: string;
    mapTime: string;
    now: string;
    /** Time from now on the map's timeline, in minutes (whole tens): "+2 h 40 min". */
    offset: (minutes: number) => string;
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
    /** The live map layers could not be loaded; they are asked for again shortly. */
    unavailable: string;
    probe: {
      noRain: (cloudPercent: number) => string;
      rain: (rate: string) => string;
      clouds: (percent: number) => string;
      temperature: (temp: string) => string;
      wind: (speed: number) => string;
      pressure: (hpa: string) => string;
    };
  };

  cyclones: {
    category: Record<CycloneCategory, string>;
    /** "Typhoon IN-FA"; a storm without a name goes by its number. */
    storm: (category: string, name: string) => string;
    /** A time with its day: "14:00 tomorrow" / "พรุ่งนี้ 14:00 น."; `day` is 0 for today, 1 for tomorrow. */
    when: (clock: string, day: number, weekday: string) => string;
    /** The map's on/off button for storm tracks. */
    toggle: { short: string; long: string };
    loading: string;
    /** No storm's path or cone comes near the place. */
    none: string;
    /** Storms elsewhere in the world, after `none`. */
    elsewhere: (count: number) => string;
    unavailable: string;
    /** Marks the made-up storm of `?cyclones=demo`. */
    demo: string;
    /** Text around the "ECMWF" link under the map while tracks show. */
    credit: { before: string; after: string };
    popup: {
      /** One point of the path: when, wind and pressure. */
      point: (when: string, windKmh: number | null, pressureHpa: number | null) => string;
      away: (km: number, place: string) => string;
      closest: (km: number, place: string, when: string) => string;
      /** For the storm's marker at the map's time. */
      at: (when: string) => string;
      /** The ECMWF run the tracks come from, which is older while ECMWF can't be reached. */
      run: (when: string) => string;
    };
  };

  /** Storm alerts by push notification: the bell in the header, its card, the banner's link and the test push. */
  push: {
    /** The bell's label and the card's title. */
    title: string;
    /** The bell's label while alerts are on. */
    bellOn: string;
    /** What alerts do, before turning them on. */
    why: (alertKm: number) => string;
    /** What is kept, where, who delivers it and for how long. */
    detailsLabel: string;
    details: string;
    turnOn: string;
    notNow: string;
    /** iPhone or iPad in a Safari tab: push needs DooFah on the Home Screen. */
    install: string;
    /** The browser's permission was refused. */
    blocked: string;
    on: (places: number) => string;
    turnOff: string;
    sendTest: string;
    testSent: string;
    /** A test was sent less than a minute ago. */
    testWait: string;
    failed: string;
    /** The storm banner's link to the card. */
    chip: string;
    /** The test notification itself. */
    testTitle: string;
    testBody: string;
    /** The card's close button. */
    close: string;
  };

  errors: {
    forecast: string;
    /** No connection: the forecast shown is the one saved at `clock`. */
    offline: (clock: string) => string;
    /** The forecast saved at `clock` is on screen while a new one loads. */
    updating: (clock: string) => string;
    retry: string;
  };

  footer: {
    /** `?data=sim`: says the weather is simulated demo data, and its made-up run. */
    credit: string;
    modelRun: (utc: string) => string;
    /** Live forecasts: "Forecast:", then the text around TMD's name when WRF is used, then ECMWF "via" Open-Meteo.com. */
    forecastBy: string;
    wrf: { before: string; after: string };
    tmd: string;
    via: string;
    /** Before "Copernicus CAMS". */
    airBy: string;
    /** Before the operator's email address. */
    contact: string;
    /** What storm alerts keep on the server, shown once push is set up. */
    pushPrivacy: string;
  };
}
