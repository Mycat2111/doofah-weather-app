"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Bus, Car, Footprints, Shirt, Sparkles, Sun, Telescope, type LucideIcon } from "lucide-react";
import { CardLabel, GlassCard } from "@/components/ui/GlassCard";
import { useI18n } from "@/i18n/I18nProvider";
import type { Activity, Level, LifestyleStatus } from "@/lib/lifestyle";

const ICON: Record<Activity, LucideIcon> = {
  laundry: Shirt,
  carWash: Car,
  run: Footprints,
  commute: Bus,
  sunscreen: Sun,
  stargazing: Telescope,
};

const TONE: Record<Level, { text: string; dot: string; glow: string }> = {
  good: { text: "text-emerald-200", dot: "bg-emerald-300", glow: "rgba(52, 211, 153, 0.34)" },
  fair: { text: "text-amber-200", dot: "bg-amber-300", glow: "rgba(252, 211, 77, 0.3)" },
  poor: { text: "text-rose-200", dot: "bg-rose-400", glow: "rgba(251, 113, 133, 0.36)" },
};

interface LifestyleIndexProps {
  statuses: LifestyleStatus[];
  timeZone: string;
  className?: string;
}

/** A row of quick "is now a good time?" cards for everyday plans. */
export function LifestyleIndex({ statuses, timeZone, className = "" }: LifestyleIndexProps) {
  const { m } = useI18n();
  return (
    <GlassCard className={`p-4 sm:p-5 ${className}`} index={2} aria-label={m.lifestyle.title}>
      <CardLabel icon={<Sparkles className="size-3.5" />}>{m.lifestyle.title}</CardLabel>
      <ul className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        {statuses.map((status, i) => (
          <LifestyleCard key={status.activity} status={status} index={i} timeZone={timeZone} />
        ))}
      </ul>
    </GlassCard>
  );
}

function LifestyleCard({ status, index, timeZone }: { status: LifestyleStatus; index: number; timeZone: string }) {
  const { m, f } = useI18n();
  const { activity, level, reason } = status;
  const Icon = ICON[activity];
  const tone = TONE[level];
  const label = m.lifestyle.status[activity][level];
  const detail = m.lifestyleReason(reason, (time) => f.clock(time, timeZone));

  return (
    <motion.li
      initial={{ opacity: 0, y: 14, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.5, delay: 0.15 + index * 0.06, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -3 }}
      className="relative flex min-h-[136px] min-w-0 flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.06] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
    >
      {/* A soft glow in the status colour. */}
      <motion.span
        className="pointer-events-none absolute -right-10 -top-10 size-28 rounded-full blur-2xl"
        initial={false}
        animate={{ backgroundColor: tone.glow }}
        transition={{ duration: 0.6 }}
        aria-hidden
      />
      <div className="relative flex items-center justify-between">
        <span className="grid size-9 place-items-center rounded-xl bg-white/10 ring-1 ring-white/10">
          <Icon className="size-[18px] text-white/90" aria-hidden />
        </span>
        <span className="relative flex size-2.5" aria-hidden>
          {level === "poor" && (
            <span
              className={`absolute inline-flex size-full animate-ping rounded-full opacity-70 motion-reduce:animate-none ${tone.dot}`}
            />
          )}
          <span className={`relative inline-flex size-2.5 rounded-full ${tone.dot}`} />
        </span>
      </div>
      <p className="relative mt-3 text-xs text-white/60 th:text-[13px]">{m.lifestyle.activities[activity]}</p>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={`${level}:${detail}`}
          className="relative"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        >
          <p className={`text-[15px] font-semibold leading-snug ${tone.text}`}>{label}</p>
          <p className="mt-1 text-xs leading-snug text-white/60 th:text-[13px]">{detail}</p>
        </motion.div>
      </AnimatePresence>
    </motion.li>
  );
}
