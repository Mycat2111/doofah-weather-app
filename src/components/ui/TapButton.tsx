"use client";

import { motion, type HTMLMotionProps } from "framer-motion";
import { haptic, type HapticKind } from "@/lib/haptics";

type TapButtonProps = HTMLMotionProps<"button"> & {
  /** Vibration on press. Only for choices and toggles; plain navigation stays silent. */
  haptic?: HapticKind;
  /** How far the button squeezes while held down. */
  tapScale?: number;
};

/** A button that squeezes while pressed and springs back, like a native control. */
export function TapButton({ haptic: kind, tapScale = 0.94, type = "button", onClick, ...props }: TapButtonProps) {
  return (
    <motion.button
      type={type}
      whileTap={{ scale: tapScale }}
      onClick={(e) => {
        if (kind) haptic(kind);
        onClick?.(e);
      }}
      {...props}
    />
  );
}

/**
 * For pickers whose highlight slides between options: give the button
 * `whileTap="pressed"` and its label these variants, so the label squeezes
 * while the highlight behind it stays put.
 */
export const PRESSED_LABEL = { pressed: { scale: 0.86 } };
