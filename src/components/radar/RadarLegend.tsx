import type { RadarLayerType } from "@/services/WeatherNext3MockService";
import { SCALES, legendGradient, legendPosition } from "./colorScales";

const TITLES: Record<RadarLayerType, string> = {
  precipitation: "Precipitation",
  wind: "10 m wind",
  temperature: "2 m temperature",
  pressure: "Sea-level pressure",
};

export function RadarLegend({ layer }: { layer: RadarLayerType }) {
  const scale = SCALES[layer];
  return (
    <div className="w-full min-w-[180px] sm:w-[220px]">
      <div className="flex items-baseline justify-between text-[10px] font-medium uppercase tracking-wider text-white/55">
        <span>{TITLES[layer]}</span>
        <span className="normal-case tracking-normal">{scale.unit}</span>
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
