import type { StopRain } from "@/lib/routeWeather";

/** One colour per rain level, shared by the journey timeline and the route on the map. */
export const RAIN_COLOR: Record<StopRain, string> = {
  dry: "#e0f2fe",
  possible: "#7dd3fc",
  rain: "#3b82f6",
  heavy: "#6366f1",
  storm: "#c084fc",
};
