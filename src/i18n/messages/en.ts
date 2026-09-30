import { describeDayEn, describeNowcastEn } from "@/services/weathernext3/describe";
import type { WeatherCondition } from "@/services/weathernext3/types";
import type { LifestyleReason } from "@/lib/lifestyle";
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

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

export const en: Messages = {
  meta: {
    title: "DooFah ดูฟ้า · Look at the Sky",
    description:
      "Hyper-local weather with a 5 km radar map, hourly and 15-day forecasts, powered by simulated WeatherNext 3 data.",
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
    retry: "Retry",
  },

  footer: {
    credit: "DooFah ดูฟ้า · Forecast data is simulated in the style of WeatherNext 3 (5 km grid, hourly, 15 days)",
    modelRun: (utc) => `model run ${utc} UTC`,
  },
};
