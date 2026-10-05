"use client";

import { AnimatePresence, motion } from "framer-motion";
import { BadgeCheck, Users, type LucideIcon } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import type { Verification, VerificationStatus } from "@/lib/crowdVerify";

const LOOK: Record<VerificationStatus, { icon: LucideIcon; tone: string }> = {
  verified: { icon: BadgeCheck, tone: "text-emerald-300" },
  disputed: { icon: Users, tone: "text-amber-200" },
  few: { icon: Users, tone: "text-sky-200" },
};

/** "Verified by 5 local users": how people's reports from the last 3 hours compare with the rain radar. */
export function CrowdVerifiedBadge({ verification }: { verification: Verification | null }) {
  const { m } = useI18n();
  const text = !verification
    ? null
    : verification.status === "verified"
      ? m.reports.verified(verification.agreeing)
      : verification.status === "disputed"
        ? m.reports.disputed(verification.agreeing, verification.total)
        : m.reports.few(verification.total);
  const look = verification ? LOOK[verification.status] : null;

  return (
    <AnimatePresence>
      {verification && look && text && (
        <motion.p
          layout
          initial={{ opacity: 0, y: -6, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, scale: 0.9 }}
          transition={{ type: "spring", stiffness: 420, damping: 30 }}
          className="glass-dark pointer-events-auto flex w-fit items-center gap-1.5 rounded-full py-1 pl-1.5 pr-3 text-[11px] font-medium text-white/90 shadow-lg th:text-xs"
        >
          <span className={`relative grid size-5 place-items-center rounded-full bg-white/10 ${look.tone}`}>
            {verification.status === "verified" && (
              <motion.span
                className="absolute inset-0 rounded-full bg-emerald-300/40 motion-reduce:hidden"
                initial={{ scale: 1, opacity: 0.7 }}
                animate={{ scale: 1.8, opacity: 0 }}
                transition={{ duration: 2.2, repeat: Infinity, ease: "easeOut" }}
                aria-hidden
              />
            )}
            <look.icon className="relative size-3.5" aria-hidden />
          </span>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={text}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.25 }}
            >
              {text}
            </motion.span>
          </AnimatePresence>
        </motion.p>
      )}
    </AnimatePresence>
  );
}
