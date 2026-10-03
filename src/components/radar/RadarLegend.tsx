"use client";

import { useI18n } from "@/i18n/I18nProvider";
import type { RadarLayerType } from "@/services/weather/types";
import { SCALES, legendGradient, legendPosition } from "./colorScales";

// Units spelled differently in Thai; °C and hPa read the same in both languages.
const TRANSLATED_UNITS = { "mm/h": "mmPerHour", "km/h": "kmh" } as const;

export function RadarLegend({ layer }: { layer: RadarLayerType }) {
  const { m } = useI18n();
  const scale = SCALES[layer];
  const key = TRANSLATED_UNITS[scale.unit as keyof typeof TRANSLATED_UNITS];
  const unit = key ? m.units[key] : scale.unit;
  return (
    <div className="w-full min-w-[180px] sm:w-[220px]">
      <div className="flex items-baseline justify-between text-[10px] font-medium uppercase tracking-wider text-white/55 th:text-[11.5px] th:tracking-normal">
        <span>{m.radar.layers[layer].legend}</span>
        <span className="normal-case tracking-normal">{unit}</span>
      </div>
      <div className="mt-1.5 h-2 rounded-full" style={{ background: legendGradient(scale) }} />
      <div className="relative mt-1 h-3 text-[10px] text-white/60">
        {scale.ticks.map((t) => (
          <span
            key={t}
            className="absolute -translate-x-1/2"
            style={{ left: `${legendPosition(scale, t) * 100}%` }}
          >
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}
