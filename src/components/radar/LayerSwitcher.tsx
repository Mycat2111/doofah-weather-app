"use client";

import { motion } from "framer-motion";
import { Cloud, CloudRain, Gauge, Thermometer, Wind, type LucideIcon } from "lucide-react";
import { PRESSED_LABEL } from "@/components/ui/TapButton";
import { useI18n } from "@/i18n/I18nProvider";
import { haptic } from "@/lib/haptics";
import type { RadarLayerType } from "@/services/WeatherNext3MockService";

export const LAYER_OPTIONS: { id: RadarLayerType; icon: LucideIcon }[] = [
  { id: "precipitation", icon: CloudRain },
  { id: "wind", icon: Wind },
  { id: "clouds", icon: Cloud },
  { id: "temperature", icon: Thermometer },
  { id: "pressure", icon: Gauge },
];

interface LayerSwitcherProps {
  value: RadarLayerType;
  onChange: (layer: RadarLayerType) => void;
}

export function LayerSwitcher({ value, onChange }: LayerSwitcherProps) {
  const { m } = useI18n();
  return (
    <div
      role="radiogroup"
      aria-label={m.radar.layerGroup}
      className="glass-dark no-scrollbar flex max-w-full gap-0.5 overflow-x-auto rounded-full p-1 shadow-lg"
    >
      {LAYER_OPTIONS.map(({ id, icon: Icon }) => {
        const selected = id === value;
        const { short, long } = m.radar.layers[id];
        return (
          <motion.button
            key={id}
            type="button"
            role="radio"
            aria-checked={selected}
            title={long}
            whileTap="pressed"
            onClick={() => {
              if (selected) return;
              haptic("selection");
              onChange(id);
            }}
            className={`relative flex shrink-0 items-center whitespace-nowrap rounded-full px-2.5 py-1.5 text-xs font-medium transition-colors sm:px-3.5 ${
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
            <motion.span className="relative flex items-center gap-1.5" variants={PRESSED_LABEL}>
              {/* The icon pops as its layer is picked. */}
              <motion.span
                className="flex"
                initial={false}
                animate={selected ? { scale: [1, 1.35, 1], rotate: [0, -12, 0] } : { scale: 1, rotate: 0 }}
                transition={{ duration: 0.4, ease: "easeOut" }}
              >
                <Icon className="size-3.5" aria-hidden />
              </motion.span>
              {/* On phones only the picked layer shows its name, so all five fit. */}
              <span className={selected ? undefined : "max-[447px]:sr-only"}>{short}</span>
            </motion.span>
          </motion.button>
        );
      })}
    </div>
  );
}
