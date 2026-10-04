"use client";

import { motion } from "framer-motion";
import { PRESSED_LABEL } from "@/components/ui/TapButton";
import { LANGUAGE_NAMES, LOCALES } from "@/i18n/config";
import { useI18n } from "@/i18n/I18nProvider";
import { haptic } from "@/lib/haptics";

/** TH / EN switch. The choice is kept in a cookie, so the next visit opens in it. */
export function LanguageToggle({ className = "" }: { className?: string }) {
  const { locale, setLocale, m } = useI18n();
  return (
    <div
      role="radiogroup"
      aria-label={m.header.language}
      className={`glass-chip h-11 items-center gap-0.5 rounded-full p-1 max-[379px]:h-10 ${className}`}
    >
      {LOCALES.map((option) => {
        const selected = option === locale;
        return (
          <motion.button
            key={option}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={LANGUAGE_NAMES[option]}
            title={LANGUAGE_NAMES[option]}
            lang={option}
            whileTap="pressed"
            onClick={() => {
              if (selected) return;
              haptic("selection");
              setLocale(option);
            }}
            className={`relative h-full min-w-9 rounded-full px-2.5 text-xs font-semibold tracking-wide transition-colors max-[379px]:min-w-8 max-[379px]:px-2 ${
              selected ? "text-slate-900" : "text-white/70 hover:text-white"
            }`}
          >
            {selected && (
              <motion.span
                layoutId="locale-pill"
                className="absolute inset-0 rounded-full bg-white"
                transition={{ type: "spring", stiffness: 500, damping: 38 }}
              />
            )}
            <motion.span className="relative block" variants={PRESSED_LABEL}>
              {option.toUpperCase()}
            </motion.span>
          </motion.button>
        );
      })}
    </div>
  );
}
