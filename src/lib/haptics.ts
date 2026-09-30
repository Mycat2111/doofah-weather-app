/**
 * Short vibrations that confirm a tap, the way native apps do.
 *
 * - Android: the Vibration API.
 * - iPhone: Safari has no Vibration API, but since iOS 18 flipping an
 *   `<input type="checkbox" switch>` plays the system selection tick, so a
 *   hidden one is flipped through its label. iOS only allows it during a tap.
 * - Everywhere else (desktop) this does nothing.
 *
 * Used for choices and toggles, not for every button, so it stays subtle.
 */
export type HapticKind = "selection" | "light" | "success";

const PATTERNS: Record<HapticKind, number | number[]> = {
  selection: 10,
  light: 16,
  success: [12, 60, 18],
};

/** Ticks closer together than this (a fast scrub) blur into one buzz. */
const MIN_GAP_MS = 40;
let last = -Infinity;

export function haptic(kind: HapticKind = "selection") {
  if (typeof window === "undefined") return;
  const now = performance.now();
  if (now - last < MIN_GAP_MS) return;
  last = now;
  try {
    if (typeof navigator.vibrate === "function") {
      navigator.vibrate(PATTERNS[kind]);
    } else if (window.matchMedia("(pointer: coarse)").matches) {
      flipHiddenSwitch();
    }
  } catch {
    // A nicety only: never let it break the tap that called it.
  }
}

function flipHiddenSwitch() {
  const label = document.createElement("label");
  label.setAttribute("aria-hidden", "true");
  label.style.display = "none";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.setAttribute("switch", "");
  label.append(input);
  document.head.append(label);
  label.click();
  label.remove();
}
