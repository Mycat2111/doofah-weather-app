"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Clock,
  CloudLightning,
  Fan,
  Footprints,
  Haze,
  HeartPulse,
  House,
  PlugZap,
  ShieldCheck,
  TreePine,
  Umbrella,
  Waves,
  X,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { TapButton } from "@/components/ui/TapButton";
import { useI18n } from "@/i18n/I18nProvider";
import { alertTips, RAIN_WINDOW_HOURS, type AlertTip, type WeatherAlert } from "@/lib/alerts";

const TIP_ICONS: Record<AlertTip, LucideIcon> = {
  umbrella: Umbrella,
  stayIndoors: House,
  avoidOpenGround: TreePine,
  unplug: PlugZap,
  travelTime: Clock,
  floodedRoads: Waves,
  mask: ShieldCheck,
  noOutdoorExercise: Footprints,
  closeWindows: Fan,
  sensitiveGroups: HeartPulse,
};

interface Look {
  icon: LucideIcon;
  /** Card background: a tint over a dark base so white text reads on any sky. */
  background: string;
  border: string;
  badge: string;
}

function lookFor(alert: WeatherAlert): Look {
  switch (alert.kind) {
    case "storm":
      return {
        icon: CloudLightning,
        background: "linear-gradient(135deg, rgba(124, 58, 237, 0.62), rgba(30, 27, 75, 0.72))",
        border: "border-violet-200/35",
        badge: "bg-amber-300 text-slate-900",
      };
    case "rain":
      return {
        icon: Umbrella,
        background: "linear-gradient(135deg, rgba(14, 116, 204, 0.6), rgba(12, 22, 52, 0.7))",
        border: "border-sky-200/35",
        badge: "bg-sky-200 text-slate-900",
      };
    case "air":
      return alert.level === "severe"
        ? {
            icon: Haze,
            background: "linear-gradient(135deg, rgba(190, 18, 60, 0.66), rgba(40, 12, 30, 0.74))",
            border: "border-rose-200/35",
            badge: "bg-rose-200 text-rose-950",
          }
        : {
            icon: Haze,
            background: "linear-gradient(135deg, rgba(234, 88, 12, 0.62), rgba(48, 20, 16, 0.72))",
            border: "border-orange-200/35",
            badge: "bg-orange-200 text-orange-950",
          };
  }
}

/** Dismissed alerts come back when they get worse (soon → now, warning → severe). */
const alertKey = (placeId: string, a: WeatherAlert) =>
  [placeId, a.kind, a.level, a.kind === "air" || a.startsAt === null ? "now" : "soon"].join(":");

interface WeatherAlertBannerProps {
  alerts: WeatherAlert[];
  placeId: string;
  timeZone: string;
}

/** Warnings for storms, likely rain and unhealthy air, with what to do about them. */
export function WeatherAlertBanner({ alerts, placeId, timeZone }: WeatherAlertBannerProps) {
  const { m, f } = useI18n();
  const [dismissed, setDismissed] = useState<string[]>([]);
  const shown = alerts.filter((a) => !dismissed.includes(alertKey(placeId, a)));

  const headline = (a: WeatherAlert) => {
    switch (a.kind) {
      case "storm":
        return a.startsAt ? m.alerts.stormFrom(f.clock(a.startsAt, timeZone)) : m.alerts.stormNow;
      case "rain":
        return a.startsAt ? m.alerts.rainFrom(f.clock(a.startsAt, timeZone)) : m.alerts.rainNow;
      case "air":
        return m.alerts.air(m.aqi[a.category]);
    }
  };

  const detail = (a: WeatherAlert) => {
    switch (a.kind) {
      case "storm":
        return m.alerts.stormDetail(a.chance);
      case "rain": {
        const text = m.alerts.rainDetail(a.chance, RAIN_WINDOW_HOURS);
        return a.heavy ? `${text} · ${m.alerts.heavyAtTimes}` : text;
      }
      case "air":
        return m.alerts.airDetail(a.aqi, `${Math.round(a.pm25)} ${m.units.microgramsPerCubicMetre}`);
    }
  };

  return (
    <section aria-label={m.alerts.label} aria-live="polite">
      <AnimatePresence initial={false}>
        {shown.map((a) => {
          const key = alertKey(placeId, a);
          const look = lookFor(a);
          const Icon = look.icon;
          return (
            <motion.div
              key={key}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              className="overflow-hidden"
            >
              <div className="pt-3">
                <div
                  className={`flex gap-3 rounded-3xl border p-4 backdrop-blur-xl sm:gap-4 sm:p-5 ${look.border}`}
                  style={{ background: look.background }}
                >
                  <span className={`relative grid size-11 shrink-0 place-items-center rounded-2xl ${look.badge}`}>
                    {a.level === "severe" && (
                      <motion.span
                        aria-hidden
                        className={`absolute inset-0 rounded-2xl ${look.badge}`}
                        animate={{ scale: [1, 1.35], opacity: [0.35, 0] }}
                        transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
                      />
                    )}
                    <Icon className="relative size-6" aria-hidden />
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-base font-semibold leading-snug sm:text-lg">{headline(a)}</p>
                        <p className="mt-0.5 text-sm text-white/80">{detail(a)}</p>
                      </div>
                      <TapButton
                        haptic="light"
                        tapScale={0.85}
                        onClick={() => setDismissed((d) => [...d, key])}
                        aria-label={m.alerts.dismiss}
                        title={m.alerts.dismiss}
                        className="-mr-1.5 -mt-1.5 grid size-9 shrink-0 place-items-center rounded-full text-white/70 hover:bg-white/15 hover:text-white"
                      >
                        <X className="size-4" aria-hidden />
                      </TapButton>
                    </div>

                    <ul aria-label={m.alerts.tipsLabel} className="mt-3 flex flex-wrap gap-1.5">
                      {alertTips(a).map((tip) => {
                        const TipIcon = TIP_ICONS[tip];
                        return (
                          <li
                            key={tip}
                            className="flex items-center gap-1.5 rounded-full border border-white/15 bg-white/12 px-2.5 py-1 text-xs font-medium text-white/95 th:text-[13px]"
                          >
                            <TipIcon className="size-3.5 shrink-0" aria-hidden />
                            {m.alerts.tips[tip]}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </div>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </section>
  );
}
