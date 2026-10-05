"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, Cloud, CloudDrizzle, CloudRainWind, Moon, Sun, Users, type LucideIcon } from "lucide-react";
import { TapButton } from "@/components/ui/TapButton";
import { useI18n } from "@/i18n/I18nProvider";
import { REPORT_KINDS, type CrowdReport, type ReportKind } from "@/lib/crowdReports";

export const REPORT_STYLE: Record<ReportKind, { icon: LucideIcon; night?: LucideIcon; color: string }> = {
  sunny: { icon: Sun, night: Moon, color: "text-amber-200" },
  cloudy: { icon: Cloud, color: "text-slate-100" },
  lightRain: { icon: CloudDrizzle, color: "text-sky-300" },
  heavyRain: { icon: CloudRainWind, color: "text-indigo-300" },
};

/** Say that the sky is sunny, cloudy or raining where you are, in one tap. */
export function WeatherReportBar({
  nearby,
  mine,
  now,
  isDay,
  onReport,
}: {
  /** Other people's live reports nearby. */
  nearby: number;
  mine: CrowdReport | null;
  now: number;
  isDay: boolean;
  onReport: (kind: ReportKind) => void;
}) {
  const { m } = useI18n();
  const name = (kind: ReportKind) => (kind === "sunny" && !isDay ? m.reports.clear : m.reports.kinds[kind]);
  const minutes = mine ? Math.max(0, Math.floor((now - Date.parse(mine.time)) / 60_000)) : 0;
  const status = !mine
    ? { key: "hint", text: m.reports.hint }
    : minutes < 1
      ? { key: `thanks-${mine.id}`, text: m.reports.thanks }
      : { key: `yours-${mine.id}-${minutes}`, text: m.reports.yours(name(mine.kind), m.reports.ago(minutes)) };

  return (
    <div className="mt-3 rounded-2xl bg-black/10 p-3.5" role="group" aria-label={m.reports.title}>
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
        <p className="flex items-center gap-1.5 text-[13px] font-medium text-white/90">
          <Users className="size-3.5 shrink-0 text-sky-200" aria-hidden />
          {m.reports.title}
        </p>
        {nearby > 0 && <span className="text-[11px] text-white/50 th:text-xs">{m.reports.nearby(nearby)}</span>}
      </div>

      <div className="mt-2.5 grid grid-cols-4 gap-1.5 max-[359px]:grid-cols-2">
        {REPORT_KINDS.map((kind) => {
          const style = REPORT_STYLE[kind];
          const Icon = !isDay && style.night ? style.night : style.icon;
          const picked = mine?.kind === kind;
          return (
            <TapButton
              key={kind}
              haptic="success"
              tapScale={0.88}
              aria-pressed={picked}
              onClick={() => onReport(kind)}
              className={`relative flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-[11px] font-medium leading-tight transition-colors th:text-xs ${
                picked ? "text-white" : "bg-white/[0.07] text-white/80 hover:bg-white/[0.12]"
              }`}
            >
              {picked && (
                <motion.span
                  layoutId="report-picked"
                  className="absolute inset-0 rounded-xl bg-white/20 ring-1 ring-white/50"
                  transition={{ type: "spring", stiffness: 480, damping: 36 }}
                />
              )}
              <motion.span
                key={picked ? `${kind}-${mine?.id}` : kind}
                className={`relative ${style.color}`}
                // The picked icon pops each time a report is sent.
                initial={picked ? { scale: 0.4, rotate: -20 } : false}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: "spring", stiffness: 420, damping: 14 }}
              >
                <Icon className="size-5" aria-hidden />
              </motion.span>
              <span className="relative text-center">{name(kind)}</span>
              {picked && (
                <motion.span
                  className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full bg-emerald-400 text-slate-900 shadow"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", stiffness: 500, damping: 18, delay: 0.1 }}
                  aria-hidden
                >
                  <Check className="size-3" strokeWidth={3} />
                </motion.span>
              )}
            </TapButton>
          );
        })}
      </div>

      <div className="relative mt-2 min-h-4 overflow-hidden">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.p
            key={status.key}
            className={`text-xs th:text-[13px] ${status.key.startsWith("thanks") ? "text-emerald-200" : "text-white/60"}`}
            initial={{ y: 10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -10, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          >
            {status.text}
          </motion.p>
        </AnimatePresence>
      </div>
    </div>
  );
}
