import { describeDayEn, describeNowcastEn } from "@/services/weathernext3/describe";
import type { WeatherCondition } from "@/services/weathernext3/types";
import type { LifestyleReason } from "@/lib/lifestyle";
import type { RouteOutlook } from "@/lib/routeWeather";
import type { SummaryContext, SummaryFact } from "@/lib/voiceSummary";
import type { AqiCategory } from "@/services/weathernext3/types";
import { spokenTimeEn, spokenWaitEn } from "../spokenTime";
import type { Messages } from "./types";

const CONDITION: Record<WeatherCondition, string> = {
  clear: "Clear",
  "partly-cloudy": "Partly cloudy",
  cloudy: "Cloudy",
  fog: "Fog",
  drizzle: "Drizzle",
  rain: "Rain",
  "heavy-rain": "Heavy rain",
  thunderstorm: "Thunderstorms",
  snow: "Snow",
};

function lifestyleReason(reason: LifestyleReason, clock: (time: string) => string): string {
  switch (reason.kind) {
    case "rainNow":
      return "Raining now";
    case "rainAt":
      return `Rain likely around ${clock(reason.time)}`;
    case "heavyRain":
      return reason.time ? `Heavy rain around ${clock(reason.time)}` : "Heavy rain now";
    case "rainTomorrow":
      return `${reason.chance}% chance of rain tomorrow`;
    case "rainTonight":
      return "Rain likely tonight";
    case "dryUntil":
      return `Dry until ${clock(reason.time)}`;
    case "dryDays":
      return `Dry for the next ${reason.days} days`;
    case "noSun":
      return "Wait for the morning sun";
    case "humid":
      return `Humid air (${reason.humidity}%) dries slowly`;
    case "storm":
      return "Thunderstorms nearby";
    case "air":
      return `Air quality AQI ${reason.aqi}`;
    case "heat":
      return reason.coolerAt
        ? `Feels like ${reason.feelsLikeC}°, cooler from ${clock(reason.coolerAt)}`
        : `Feels like ${reason.feelsLikeC}°`;
    case "pleasant":
      return `Feels like ${reason.feelsLikeC}°`;
    case "uv":
      return `UV up to ${reason.peak} until ${clock(reason.until)}`;
    case "uvLow":
      return "UV stays low today";
    case "sunDown":
      return "The sun is down";
    case "fog":
      return `Visibility ${reason.visibilityKm} km`;
    case "clearRoads":
      return "No rain or fog ahead";
    case "clouds":
      return `${reason.percent}% cloud tonight`;
  }
}

const ROUTE_LEVEL = { rain: "Rain likely", heavy: "Heavy rain", storm: "Thunderstorms" };
const ROUTE_PATCHY = { rain: "Showers on and off", heavy: "Heavy rain on and off", storm: "Thunderstorms on and off" };

function routeOutlook(
  outlook: RouteOutlook,
  stop: (index: number) => string,
  clock: (index: number) => string,
): string {
  switch (outlook.kind) {
    case "dry":
      return "Dry all the way";
    case "possible":
      return `A chance of showers near ${stop(outlook.stop)} around ${clock(outlook.stop)} (${outlook.chance}%)`;
    case "rain": {
      const level = (outlook.patchy ? ROUTE_PATCHY : ROUTE_LEVEL)[outlook.level];
      return outlook.from === outlook.to
        ? `${level} near ${stop(outlook.from)} around ${clock(outlook.from)}`
        : `${level} from ${stop(outlook.from)} to ${stop(outlook.to)}, ${clock(outlook.from)}–${clock(outlook.to)}`;
    }
  }
}

/* Spoken summary ------------------------------------------------------- */

const SPOKEN_CONDITION: Record<WeatherCondition, [day: string, night: string]> = {
  clear: ["sunny", "clear"],
  "partly-cloudy": ["partly cloudy", "partly cloudy"],
  cloudy: ["cloudy", "cloudy"],
  fog: ["foggy", "foggy"],
  drizzle: ["drizzly", "drizzly"],
  rain: ["raining", "raining"],
  "heavy-rain": ["raining heavily", "raining heavily"],
  thunderstorm: ["stormy", "stormy"],
  snow: ["snowing", "snowing"],
};

const SPOKEN_AQI: Record<AqiCategory, string> = {
  Good: "good",
  Moderate: "moderate",
  "Unhealthy for Sensitive Groups": "unhealthy for sensitive groups",
  Unhealthy: "unhealthy",
  "Very Unhealthy": "very unhealthy",
  Hazardous: "hazardous",
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const GREETING = {
  morning: "Good morning!",
  afternoon: "Good afternoon!",
  evening: "Good evening!",
  night: "Hi there!",
};

function voiceSummary(facts: SummaryFact[], { place, clock }: SummaryContext): string[] {
  const at = (time: string) => {
    const { hour, minute } = clock(time);
    return spokenTimeEn(hour, minute);
  };
  return facts.map((fact) => {
    switch (fact.kind) {
      case "greeting":
        return GREETING[fact.part];
      case "now": {
        const where = place ? `in ${place}` : "where you are";
        const sky = SPOKEN_CONDITION[fact.condition][fact.isDay ? 0 : 1];
        const feels = fact.feelsLikeC === null ? "" : `, but it feels like ${fact.feelsLikeC}`;
        return `Right now ${where} it's ${fact.tempC} degrees and ${sky}${feels}.`;
      }
      case "rainStarting":
        switch (fact.intensity) {
          case "heavy":
            return `Heavy rain is on its way, arriving in ${spokenWaitEn(fact.minutes)}, so grab an umbrella before you head out.`;
          case "drizzle":
            return `Expect a little drizzle in ${spokenWaitEn(fact.minutes)}.`;
          default:
            return `${fact.intensity === "light" ? "Light rain" : "Rain"} should start in ${spokenWaitEn(fact.minutes)}, so keep an umbrella handy.`;
        }
      case "raining":
        if (!fact.until) return "It looks set to keep going for a while, so take an umbrella if you head out.";
        return fact.intensity === "heavy"
          ? `It should ease off around ${at(fact.until)}; watch out for flooded roads until then.`
          : `It should ease off around ${at(fact.until)}.`;
      case "rainLater": {
        const when = fact.thisHour ? "within the hour" : `${fact.tomorrow ? "tomorrow " : ""}around ${at(fact.at)}`;
        if (fact.storm) return `Expect thunderstorms ${when}, so plan to be indoors by then.`;
        if (fact.heavy) return `Expect heavy rain ${when}, so you might want to bring an umbrella.`;
        if (fact.likely) return `Rain is likely ${when}, so you might want to bring an umbrella.`;
        return `There's a ${fact.chance} percent chance of rain ${when}, so an umbrella wouldn't hurt.`;
      }
      case "dry":
        return fact.weekday === null
          ? `No rain is expected in the next ${fact.hours} hours.`
          : `No rain is expected in the next ${fact.hours} hours, and the next rainy day looks like ${WEEKDAYS[fact.weekday]}.`;
      case "today":
        return `Today's high is ${fact.maxC} degrees.`;
      case "tonight":
        return `Tonight it drops to around ${fact.minC}.`;
      case "tomorrow": {
        const day = describeDayEn(fact.outlook).replace(/(\d) mm\b/, "$1 millimeters");
        return `Tomorrow: ${day.charAt(0).toLowerCase()}${day.slice(1)}, from ${fact.minC} to ${fact.maxC} degrees.`;
      }
      case "uv":
        return `The UV index will reach ${fact.peak}, so wear sunscreen if you're out in the sun.`;
      case "heat":
        return "It's dangerously hot, so drink plenty of water and stay in the shade.";
      case "air":
        return `The air is ${SPOKEN_AQI[fact.category]}, at AQI ${fact.aqi}, so consider a mask outdoors.`;
    }
  });
}

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

export const en: Messages = {
  meta: {
    title: "DooFah ดูฟ้า · Look at the Sky",
    description:
      "Hyper-local weather with a radar map, a rain countdown, hourly and 15-day forecasts, and the weather along your drive.",
  },

  units: {
    kmh: "km/h",
    km: "km",
    mm: "mm",
    mmPerHour: "mm/h",
    metres: "m",
    microgramsPerCubicMetre: "µg/m³",
  },

  condition: (condition, isDay) => (condition === "clear" && isDay ? "Sunny" : CONDITION[condition]),
  aqi: {
    Good: "Good",
    Moderate: "Moderate",
    "Unhealthy for Sensitive Groups": "Sensitive",
    Unhealthy: "Unhealthy",
    "Very Unhealthy": "Very unhealthy",
    Hazardous: "Hazardous",
  },
  uv: (index) => {
    if (index < 3) return "Low";
    if (index < 6) return "Moderate";
    if (index < 8) return "High";
    if (index < 11) return "Very high";
    return "Extreme";
  },
  compass: (degrees) => COMPASS[Math.round((((degrees % 360) + 360) % 360) / 22.5) % 16],
  nowcast: describeNowcastEn,
  daySummary: describeDayEn,
  routeOutlook,
  voiceSummary,
  forecastModel: {
    label: "Forecast model",
    thisHour: "This hour's forecast",
    about: {
      WRF: "WRF from the Thai Meteorological Department, 3 km",
      ECMWF: "ECMWF's IFS, 9 km",
      "WRF+ECMWF": "WRF easing into ECMWF",
    },
  },
  lifestyleReason,

  header: {
    searchPlaceholder: "Search a city… (e.g. Chiang Mai)",
    searchLabel: "Search for a place",
    closeSearch: "Close search",
    locate: "Use my location",
    locateDenied: "Location permission was denied",
    locateUnavailable: "Location is unavailable",
    language: "Language",
  },

  favorites: {
    label: "Favorite places",
    empty: "Tap the star next to a place's name to pin it here",
    save: (place) => `Save ${place} to favorites`,
    remove: (place) => `Remove ${place} from favorites`,
    editFavorite: (place) => `Edit favorite: ${place}`,
    saved: "Saved to favorites",
    name: "Name",
    quickLabels: "Quick labels",
    home: "Home",
    office: "Office",
    removeShort: "Remove",
    edit: "Edit",
    done: "Done",
  },

  alerts: {
    label: "Weather alerts",
    dismiss: "Dismiss alert",
    stormNow: "Thunderstorm now",
    stormFrom: (clock) => `Thunderstorm likely from ${clock}`,
    stormDetail: (chance) => `Lightning and strong gusts possible · ${chance}% chance of rain`,
    rainNow: "Rain likely now",
    rainFrom: (clock) => `Rain likely from ${clock}`,
    rainDetail: (chance, hours) => `Up to ${chance}% chance of rain in the next ${hours} hours`,
    heavyAtTimes: "heavy at times",
    air: (category) => `Air quality: ${category}`,
    airDetail: (aqi, pm25) => `AQI ${aqi} · PM2.5 ${pm25}`,
    tipsLabel: "What to do",
    tips: {
      umbrella: "Bring an umbrella",
      stayIndoors: "Stay indoors if you can",
      avoidOpenGround: "Keep away from open ground and tall trees",
      unplug: "Unplug sensitive electronics",
      travelTime: "Allow extra travel time",
      floodedRoads: "Watch for flooded roads",
      mask: "Wear a PM2.5 mask outdoors",
      noOutdoorExercise: "Skip outdoor exercise",
      closeWindows: "Keep windows shut and run an air purifier",
      sensitiveGroups: "Children, older people and anyone with heart or lung conditions should stay indoors",
    },
  },

  hero: {
    label: "Current weather",
    updated: (clock) => `Updated ${clock}`,
    precisionBefore: "",
    precisionAfter: " precision",
    cellTitle: (cellId) => `WeatherNext 3 grid cell ${cellId}`,
    feelsLike: (temp) => `Feels like ${temp}`,
    highLow: (high, low) => `H ${high} L ${low}`,
    now: "Now",
    hoursAhead: (hours) => `+${hours} h`,
    aqi: "AQI",
  },

  countdown: {
    label: "Rain countdown",
    rainIn: {
      drizzle: (d) => `Drizzle expected in ${d}`,
      light: (d) => `Light rain expected in ${d}`,
      moderate: (d) => `Rain expected in ${d}`,
      heavy: (d) => `Heavy rain expected in ${d}`,
    },
    startingNow: "Rain starting now",
    raining: { drizzle: "Drizzle now", light: "Light rain now", moderate: "Raining now", heavy: "Heavy rain now" },
    startsAt: (clock) => `Starts around ${clock}`,
    easesIn: (d, clock) => `Easing in ${d}, around ${clock}`,
    easesAround: (clock) => `Likely to ease around ${clock}`,
    easingNow: "Easing now",
    noBreak: (hours) => `No break for at least ${hours} hours`,
    clearFor: (hours) => `Clear sky for the next ${hours} hours`,
    dryFor: (hours) => `No rain for the next ${hours} hours`,
    rainFrom: (clock, chance) => `Rain likely from ${clock} · ${chance}% chance`,
    nextRain: (day, date) => `Next rain likely ${day}, ${date}`,
    nextRainTomorrow: "Next rain likely tomorrow",
    noRainAhead: "No rain in the 15-day outlook",
    radar: "Radar",
    likelyAround: (clock) => `Rain likely around ${clock}`,
    likelyNow: "Rain likely this hour",
    possibleAround: (clock) => `Rain possible around ${clock}`,
    possibleNow: "Rain possible this hour",
    possibleFrom: (clock, chance) => `Rain possible from ${clock} · ${chance}% chance`,
    chance: (chance) => `${chance}% chance of rain`,
    duration: (minutes) => {
      if (minutes < 60) return `${minutes} min`;
      const h = Math.floor(minutes / 60);
      const rest = minutes % 60;
      return rest ? `${h} h ${rest} min` : `${h} h`;
    },
  },

  lifestyle: {
    title: "Lifestyle index",
    activities: {
      laundry: "Laundry",
      carWash: "Car wash",
      run: "Outdoor run",
      commute: "Commute",
      sunscreen: "Sunscreen",
      stargazing: "Stargazing",
    },
    status: {
      laundry: { good: "Good time", fair: "Slow drying", poor: "Hold off" },
      carWash: { good: "Good day to wash", fair: "Risk of rain tomorrow", poor: "Not today" },
      run: { good: "Safe", fair: "Take care", poor: "Not advised" },
      commute: { good: "Smooth", fair: "Allow extra time", poor: "Delays likely" },
      sunscreen: { good: "Not needed", fair: "Recommended", poor: "Essential" },
      stargazing: { good: "Clear skies", fair: "Patchy cloud", poor: "Cloudy" },
    },
  },

  reports: {
    title: "What's the sky like where you are?",
    kinds: { sunny: "Sunny", cloudy: "Cloudy", lightRain: "Light rain", heavyRain: "Heavy rain" },
    clear: "Clear",
    hint: "One tap shares it on the map with people nearby",
    thanks: "Thanks! It's on the map for the next hour",
    yours: (kind, ago) => `You reported: ${kind} · ${ago}`,
    ago: (minutes) => (minutes < 1 ? "just now" : `${minutes} min ago`),
    nearby: (count) => (count === 1 ? "1 report nearby" : `${count} reports nearby`),
    you: "You",
    verified: (people) => `Verified by ${people} local users`,
    disputed: (agreeing, total) => `Local users differ: ${agreeing} of ${total} agree`,
    few: (count) => (count === 1 ? "1 local report" : `${count} local reports`),
  },

  route: {
    title: "Route weather",
    from: "From",
    to: "To",
    toPlaceholder: "Where to?",
    searchPlaceholder: "Search a city",
    myLocation: "My location",
    swap: "Swap start and destination",
    clear: "Clear route",
    leave: "Leave",
    leaveNow: "Now",
    leaveIn: (hours) => `In ${hours} h`,
    planning: "Planning your drive…",
    hint: "Pick a destination to see the weather at each point of the drive, at the time you get there.",
    duration: (minutes) => {
      const h = Math.floor(Math.round(minutes) / 60);
      const m = Math.round(minutes) % 60;
      return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
    },
    distance: (km) => `${Math.round(km)} km`,
    arrive: (clock) => `Arrive ${clock}`,
    ferry: (minutes) => `Car ferry · ${en.route.duration(minutes)} on board`,
    km: (km) => `km ${Math.round(km)}`,
    advice: {
      rain: "Allow extra time and keep your distance on wet roads.",
      heavy: "Slow down: expect flooded stretches and poor visibility.",
      storm: "Think about leaving later, or stop somewhere safe while it passes.",
    },
    rain: { dry: "Dry", possible: "Showers possible", rain: "Rain", heavy: "Heavy rain", storm: "Thunderstorms" },
    chance: (percent) => `${percent}%`,
    timeline: "Journey timeline",
    showOnMap: "Show on map",
    stopOnMap: (name, clock) => `${name} at ${clock}: show on the map`,
    carHere: (clock) => `You, at ${clock}`,
    errors: {
      noRoute: "There's no road or car ferry between these places.",
      samePlace: "Start and destination are the same place.",
      tooFar: "That's too far to plan a drive.",
      offline: "Planning a route needs an internet connection.",
      failed: "Couldn't reach the route planner.",
      weather: "Couldn't get the weather along the route.",
      unavailable: "Route planning isn't available on this site yet.",
    },
    retry: "Try again",
    routeBy: "Route by",
    roadCredit: { before: "Road data © ", after: " contributors" },
    fixMap: "Report a map error",
  },

  voice: {
    play: "Play AI summary",
    short: "AI summary",
    title: "AI weather summary",
    stop: "Stop",
    replay: "Play again",
    close: "Close",
    noSpeech: "This browser can't read aloud, so here is the summary to read.",
    noVoice: "There's no English voice on this device, so the reading may sound off.",
    aiVoice: "AI-generated voice · Google Cloud",
  },

  hourly: {
    label: "Hourly forecast",
    title: "Next 48 hours",
    scrollLabel: "Hourly forecast, scroll horizontally",
    earlier: "Earlier hours",
    later: "Later hours",
    now: "Now",
    sunrise: "Sunrise",
    sunset: "Sunset",
  },

  daily: {
    label: "15-day forecast",
    title: "15-day forecast",
    range: (low, high) => `Low ${low}, high ${high}`,
    nowMarker: (temp) => `Now ${temp}`,
    confidence: (percent) => `Model confidence ${percent}%`,
    sparkline: "Hourly temperature and rain",
    rain: "Rain",
    wind: "Wind",
    uv: "UV",
    humidity: "Humidity",
    sunrise: "Sunrise",
    sunset: "Sunset",
  },

  details: {
    wind: "Wind",
    windFrom: (direction) => `From ${direction}`,
    gusts: (speed) => `Gusts ${speed}`,
    humidity: "Humidity",
    dewPoint: (temp) => `Dew point ${temp}`,
    uvIndex: "UV index",
    pressure: "Pressure",
    pressureLow: "Low, unsettled",
    pressureHigh: "High, settled",
    pressureNormal: "Near normal",
    visibility: "Visibility",
    cloudCover: (percent) => `Cloud cover ${percent}%`,
    sun: "Sun",
  },

  radar: {
    label: "Weather radar map",
    layerGroup: "Map layer",
    layers: {
      precipitation: { short: "Rain", long: "Rain radar", legend: "Precipitation" },
      wind: { short: "Wind", long: "Wind stream", legend: "10 m wind" },
      temperature: { short: "Temp", long: "Temperature heatmap", legend: "2 m temperature" },
      pressure: { short: "Pressure", long: "Pressure isobars", legend: "Sea-level pressure" },
    },
    loading: "Loading layer",
    grid: (km) => `${km} km grid`,
    run: (utcClock) => `run ${utcClock} UTC`,
    play: "Play time-lapse",
    pause: "Pause time-lapse",
    mapTime: "Map time",
    now: "Now",
    offset: (hours) => (hours > 0 ? `+${hours} h` : `−${Math.abs(hours)} h`),
    past: "Past radar",
    analysis: "Latest analysis",
    forecast: "Forecast",
    outsideArea: "Outside the loaded area",
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
    recenter: "Go to my location",
    twoFingers: "Use two fingers to move the map",
    attribution: { before: "Map © ", after: " contributors" },
    simulated: "Simulated radar",
    probe: {
      noRain: (cloudPercent) => `No rain · cloud ${cloudPercent}%`,
      rain: (rate) => `Rain ${rate} mm/h`,
      temperature: (temp) => `${temp} °C at 2 m`,
      wind: (speed) => `Wind ${speed} km/h at 10 m`,
      pressure: (hpa) => `${hpa} hPa`,
    },
  },

  errors: {
    forecast: "Could not load the forecast",
    offline: (clock) => `Offline · showing the forecast from ${clock}`,
    retry: "Retry",
  },

  footer: {
    credit: "DooFah ดูฟ้า · Forecast data is simulated in the style of WeatherNext 3 (5 km grid, hourly, 15 days)",
    modelRun: (utc) => `model run ${utc} UTC`,
    forecastBy: "Forecast:",
    wrf: { before: "WRF model by the ", after: " (TMD)" },
    tmd: "Thai Meteorological Department",
    via: "via",
    airBy: "Air quality by",
    contact: "Contact:",
  },
};
