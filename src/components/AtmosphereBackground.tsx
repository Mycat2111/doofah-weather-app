"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { CSSProperties } from "react";
import type { AtmosphereTheme } from "@/services/WeatherNext3MockService";

interface Palette {
  gradient: string;
  /** Soft light source: [x%, y%, colour]. */
  glow?: [number, number, string];
  clouds?: { count: number; color: string };
  rain?: number;
  snow?: number;
  stars?: number;
  lightning?: boolean;
}

export const ATMOSPHERES: Record<AtmosphereTheme, Palette> = {
  "clear-day": {
    gradient: "linear-gradient(165deg, #5cb8ff 0%, #2f86e8 42%, #1d4fae 100%)",
    glow: [82, 6, "rgba(255, 240, 180, 0.55)"],
  },
  "clear-night": {
    gradient: "linear-gradient(170deg, #070b1f 0%, #141f4a 50%, #283a78 100%)",
    glow: [18, 12, "rgba(190, 205, 255, 0.18)"],
    stars: 90,
  },
  "golden-hour": {
    gradient: "linear-gradient(175deg, #2b3a78 0%, #7a4f9a 38%, #e0707a 68%, #ffb163 100%)",
    glow: [70, 88, "rgba(255, 190, 110, 0.65)"],
    clouds: { count: 3, color: "rgba(255, 190, 170, 0.28)" },
  },
  "cloudy-day": {
    gradient: "linear-gradient(170deg, #8ea2b8 0%, #5f7690 48%, #3a4d66 100%)",
    clouds: { count: 6, color: "rgba(240, 245, 250, 0.3)" },
  },
  "cloudy-night": {
    gradient: "linear-gradient(170deg, #121826 0%, #242e40 50%, #364256 100%)",
    clouds: { count: 5, color: "rgba(140, 155, 180, 0.22)" },
    stars: 20,
  },
  fog: {
    gradient: "linear-gradient(175deg, #8f9ba6 0%, #6c7884 50%, #4b5663 100%)",
    clouds: { count: 8, color: "rgba(230, 235, 240, 0.35)" },
  },
  rain: {
    gradient: "linear-gradient(170deg, #4a6386 0%, #33475f 50%, #1f2c3d 100%)",
    clouds: { count: 5, color: "rgba(160, 180, 205, 0.25)" },
    rain: 70,
  },
  "heavy-rain": {
    gradient: "linear-gradient(170deg, #2b3c52 0%, #1d2a3a 50%, #0f1720 100%)",
    clouds: { count: 6, color: "rgba(120, 140, 165, 0.25)" },
    rain: 150,
  },
  thunderstorm: {
    gradient: "linear-gradient(170deg, #1d1838 0%, #2a2350 45%, #0d0a1c 100%)",
    clouds: { count: 6, color: "rgba(120, 110, 170, 0.28)" },
    rain: 120,
    lightning: true,
  },
  snow: {
    gradient: "linear-gradient(170deg, #9db2c8 0%, #7189a4 50%, #4f6481 100%)",
    clouds: { count: 5, color: "rgba(235, 242, 250, 0.3)" },
    snow: 70,
  },
};

/** Deterministic pseudo-random in [0, 1) so server and client markup match. */
const rand = (i: number, salt: number) => {
  let h = Math.imul(i + 1, 0x27d4eb2d) ^ Math.imul(salt + 1, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 13;
  return Math.round(((h >>> 0) / 4294967296) * 1000) / 1000;
};

function Particles({ palette }: { palette: Palette }) {
  return (
    <>
      {palette.glow && (
        <div
          className="absolute h-[70vmax] w-[70vmax] -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            left: `${palette.glow[0]}%`,
            top: `${palette.glow[1]}%`,
            background: `radial-gradient(circle, ${palette.glow[2]} 0%, transparent 62%)`,
          }}
        />
      )}

      {Array.from({ length: palette.stars ?? 0 }, (_, i) => {
        const size = 1 + rand(i, 1) * 1.8;
        return (
          <span
            key={`s${i}`}
            className="fx-star"
            style={{
              left: `${rand(i, 2) * 100}%`,
              top: `${rand(i, 3) * 70}%`,
              width: size,
              height: size,
              animationDuration: `${2.5 + rand(i, 4) * 4}s`,
              animationDelay: `${-rand(i, 5) * 6}s`,
            }}
          />
        );
      })}

      {Array.from({ length: palette.clouds?.count ?? 0 }, (_, i) => (
        <span
          key={`c${i}`}
          className="fx-cloud"
          style={{
            top: `${-10 + rand(i, 6) * 70}%`,
            left: 0,
            width: `${35 + rand(i, 7) * 35}vw`,
            height: `${14 + rand(i, 8) * 16}vh`,
            background: palette.clouds!.color,
            animationDuration: `${70 + rand(i, 9) * 80}s`,
            animationDelay: `${-rand(i, 10) * 150}s`,
          }}
        />
      ))}

      {Array.from({ length: palette.rain ?? 0 }, (_, i) => (
        <span
          key={`r${i}`}
          className="fx-rain"
          style={
            {
              left: `${rand(i, 11) * 120}%`,
              height: `${8 + rand(i, 12) * 10}vh`,
              opacity: 0.25 + rand(i, 13) * 0.5,
              animationDuration: `${0.55 + rand(i, 14) * 0.5}s`,
              animationDelay: `${-rand(i, 15) * 2}s`,
            } as CSSProperties
          }
        />
      ))}

      {Array.from({ length: palette.snow ?? 0 }, (_, i) => {
        const size = 2 + rand(i, 16) * 4;
        return (
          <span
            key={`f${i}`}
            className="fx-snow"
            style={{
              left: `${rand(i, 17) * 100}%`,
              width: size,
              height: size,
              opacity: 0.5 + rand(i, 18) * 0.5,
              animationDuration: `${8 + rand(i, 19) * 10}s`,
              animationDelay: `${-rand(i, 20) * 18}s`,
            }}
          />
        );
      })}

      {palette.lightning && <div className="fx-lightning" />}
    </>
  );
}

/**
 * Full-screen sky that cross-fades between moods (clear day, golden hour,
 * thunderstorm, …) as the current conditions change.
 */
export function AtmosphereBackground({ theme }: { theme: AtmosphereTheme }) {
  const palette = ATMOSPHERES[theme];
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-[#0b1026]">
      <AnimatePresence initial={false}>
        <motion.div
          key={theme}
          className="absolute inset-0"
          style={{ background: palette.gradient }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.6, ease: "easeInOut" }}
        >
          <Particles palette={palette} />
        </motion.div>
      </AnimatePresence>
      {/* Gentle vignette keeps white text readable on every sky. */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,transparent_40%,rgba(0,0,0,0.28)_100%)]" />
    </div>
  );
}
