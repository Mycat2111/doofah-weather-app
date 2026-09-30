"use client";

import { motion, type HTMLMotionProps } from "framer-motion";
import type { ReactNode } from "react";

interface GlassCardProps extends HTMLMotionProps<"section"> {
  children: ReactNode;
  /** Stagger index for the entrance animation. */
  index?: number;
}

/** Translucent card that the whole design system is built from. */
export function GlassCard({ children, className = "", index = 0, ...props }: GlassCardProps) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 18, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.55, delay: 0.06 * index, ease: [0.22, 1, 0.36, 1] }}
      className={`glass rounded-[28px] ${className}`}
      {...props}
    >
      {children}
    </motion.section>
  );
}

export function CardLabel({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  // Thai has no capitals and letter-spacing pulls its marks apart, so Thai
  // labels trade the small spaced caps for a slightly larger plain weight.
  return (
    <h2 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/55 th:text-[13px] th:font-medium th:tracking-normal th:text-white/65">
      {icon}
      {children}
    </h2>
  );
}
