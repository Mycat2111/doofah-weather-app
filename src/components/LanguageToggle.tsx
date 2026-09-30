"use client";

import { motion } from "framer-motion";
import { LANGUAGE_NAMES, LOCALES } from "@/i18n/config";
import { useI18n } from "@/i18n/I18nProvider";

/** TH / EN switch. The choice is kept in a cookie, so the next visit opens in it. */
export function LanguageToggle({ className = "" }: { className?: string }) {
  const { locale, setLocale, m } = useI18n();
  return (
    <div
      role="radiogroup"
      aria-label={m.header.language}
      className={`glass-chip h-11 items-center gap-0.5 rounded-full p-1 ${className}`}
    >
      {LOCALES.map((option) => {
        const selected = option === locale;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={LANGUAGE_NAMES[option]}
            title={LANGUAGE_NAMES[option]}
            lang={option}
            onClick={() => setLocale(option)}
            className={`relative h-full min-w-9 rounded-full px-2.5 text-xs font-semibold tracking-wide transition-colors ${
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
            <span className="relative">{option.toUpperCase()}</span>
          </button>
        );
      })}
    </div>
  );
}
