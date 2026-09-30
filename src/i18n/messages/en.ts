import { describeDayEn, describeNowcastEn } from "@/services/weathernext3/describe";
import type { WeatherCondition } from "@/services/weathernext3/types";
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
