"use client";

import { motion } from "framer-motion";
import { CloudRain, Gauge, Thermometer, Wind, type LucideIcon } from "lucide-react";
import type { RadarLayerType } from "@/services/WeatherNext3MockService";

export const LAYER_OPTIONS: { id: RadarLayerType; label: string; long: string; icon: LucideIcon }[] = [
  { id: "precipitation", label: "Rain", long: "Rain radar", icon: CloudRain },
  { id: "wind", label: "Wind", long: "Wind stream", icon: Wind },
  { id: "temperature", label: "Temp", long: "Temperature heatmap", icon: Thermometer },
  { id: "pressure", label: "Pressure", long: "Pressure isobars", icon: Gauge },
];

interface LayerSwitcherProps {
  value: RadarLayerType;
  onChange: (layer: RadarLayerType) => void;
}

export function LayerSwitcher({ value, onChange }: LayerSwitcherProps) {
  return (
    <div role="radiogroup" aria-label="Map layer" className="glass-dark flex gap-0.5 rounded-full p-1 shadow-lg">
      {LAYER_OPTIONS.map(({ id, label, long, icon: Icon }) => {
        const selected = id === value;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={selected}
            title={long}
            onClick={() => onChange(id)}
            className={`relative flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors sm:px-3.5 ${
              selected ? "text-slate-900" : "text-white/75 hover:text-white"
            }`}
          >
            {selected && (
              <motion.span
                layoutId="layer-pill"
                className="absolute inset-0 rounded-full bg-white"
                transition={{ type: "spring", stiffness: 500, damping: 38 }}
              />
            )}
            <Icon className="relative size-3.5" aria-hidden />
            <span className="relative">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
