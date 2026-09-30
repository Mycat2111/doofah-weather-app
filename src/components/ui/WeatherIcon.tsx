import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudMoon,
  CloudRain,
  CloudRainWind,
  CloudSnow,
  CloudSun,
  Moon,
  Sun,
  type LucideIcon,
  type LucideProps,
} from "lucide-react";
import type { WeatherCondition } from "@/services/WeatherNext3MockService";

const ICONS: Record<WeatherCondition, { day: LucideIcon; night: LucideIcon; color: string }> = {
  clear: { day: Sun, night: Moon, color: "#fcd34d" },
  "partly-cloudy": { day: CloudSun, night: CloudMoon, color: "#fde68a" },
  cloudy: { day: Cloud, night: Cloud, color: "#e2e8f0" },
  fog: { day: CloudFog, night: CloudFog, color: "#cbd5e1" },
  drizzle: { day: CloudDrizzle, night: CloudDrizzle, color: "#bae6fd" },
  rain: { day: CloudRain, night: CloudRain, color: "#7dd3fc" },
  "heavy-rain": { day: CloudRainWind, night: CloudRainWind, color: "#38bdf8" },
  thunderstorm: { day: CloudLightning, night: CloudLightning, color: "#c4b5fd" },
  snow: { day: CloudSnow, night: CloudSnow, color: "#f1f5f9" },
};

interface WeatherIconProps extends Omit<LucideProps, "ref"> {
  condition: WeatherCondition;
  isDay?: boolean;
  /** Use the condition's accent colour instead of currentColor. */
  tinted?: boolean;
}

export function WeatherIcon({ condition, isDay = true, tinted = true, ...props }: WeatherIconProps) {
  const entry = ICONS[condition];
  const Icon = isDay ? entry.day : entry.night;
  const color = tinted ? (condition === "clear" && !isDay ? "#e0e7ff" : entry.color) : undefined;
  return <Icon aria-hidden color={color} strokeWidth={1.6} {...props} />;
}
