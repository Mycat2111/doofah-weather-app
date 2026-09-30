"use client";

import { motion } from "framer-motion";
import { Droplets, Eye, Gauge, Sun, Sunrise, Wind } from "lucide-react";
import type { ReactNode } from "react";
import { CardLabel, GlassCard } from "@/components/ui/GlassCard";
import { useI18n } from "@/i18n/I18nProvider";
import type { CurrentConditions } from "@/services/WeatherNext3MockService";

function Tile({ icon, label, children, index }: { icon: ReactNode; label: string; children: ReactNode; index: number }) {
  return (
    <GlassCard className="flex min-h-[148px] flex-col p-4" index={index}>
      <CardLabel icon={icon}>{label}</CardLabel>
      <div className="mt-2 flex flex-1 flex-col">{children}</div>
    </GlassCard>
  );
}

export function WeatherDetailsGrid({ current, className = "" }: { current: CurrentConditions; className?: string }) {
  const { m, f } = useI18n();
  const s = current.sample;
  const tz = current.place.timeZone;

  // Sun progress across today's arc.
  const rise = current.sunrise ? Date.parse(current.sunrise) : null;
  const set = current.sunset ? Date.parse(current.sunset) : null;
  const now = Date.parse(current.observedAt);
  const sunT = rise && set ? Math.min(1, Math.max(0, (now - rise) / (set - rise))) : 0;
  const arcX = 10 + sunT * 100;
  const arcY = 52 - 160 * sunT * (1 - sunT); // on the quadratic curve drawn below

  return (
    <div className={`grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-2 ${className}`}>
      <Tile icon={<Wind className="size-3.5" />} label={m.details.wind} index={5}>
        <div className="flex items-center gap-3">
          <div className="relative size-16 shrink-0 rounded-full border border-white/15 sm:size-[74px]">
            {["N", "E", "S", "W"].map((d, i) => (
              <span
                key={d}
                className="absolute text-[9px] font-semibold text-white/45"
                style={{
                  left: `${50 + Math.sin((i * Math.PI) / 2) * 40}%`,
                  top: `${50 - Math.cos((i * Math.PI) / 2) * 40}%`,
                  transform: "translate(-50%, -50%)",
                }}
              >
                {d}
              </span>
            ))}
            <motion.div
              className="absolute inset-0"
              initial={{ rotate: 0 }}
              animate={{ rotate: s.windDirectionDeg + 180 }}
              transition={{ type: "spring", stiffness: 60, damping: 12 }}
            >
              {/* A vane through the centre that stops short of the letters. */}
              <span className="absolute left-1/2 top-[27%] h-[46%] w-[2px] -translate-x-1/2 rounded bg-white" />
              <span className="absolute left-1/2 top-[21%] -translate-x-1/2 border-x-[5px] border-b-[8px] border-x-transparent border-b-white" />
            </motion.div>
          </div>
          {/* The unit drops under the number when the tile is narrow. */}
          <p className="flex flex-wrap items-baseline gap-x-1 text-2xl font-light">
            {Math.round(s.windSpeedKmh)}
            <span className="text-sm text-white/60">{m.units.kmh}</span>
          </p>
        </div>
        <div className="mt-auto pt-2 text-xs text-white/60">
          <p>{m.details.windFrom(m.compass(s.windDirectionDeg))}</p>
          <p>{m.details.gusts(`${Math.round(s.windGustKmh)} ${m.units.kmh}`)}</p>
        </div>
      </Tile>

      <Tile icon={<Droplets className="size-3.5" />} label={m.details.humidity} index={6}>
        <p className="text-3xl font-light">{s.humidity}%</p>
        <p className="mt-auto text-xs text-white/60">{m.details.dewPoint(f.temp(s.dewPointC))}</p>
      </Tile>

      <Tile icon={<Sun className="size-3.5" />} label={m.details.uvIndex} index={7}>
        <p className="text-3xl font-light">{Math.round(s.uvIndex)}</p>
        <p className="text-sm text-white/80">{m.uv(s.uvIndex)}</p>
        <div className="relative mt-auto h-1.5 rounded-full bg-[linear-gradient(90deg,#4ade80,#facc15,#fb923c,#ef4444,#a855f7)]">
          <span
            className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-black/30"
            style={{ left: `${Math.min(100, (s.uvIndex / 11) * 100)}%` }}
          />
        </div>
      </Tile>

      <Tile icon={<Gauge className="size-3.5" />} label={m.details.pressure} index={8}>
        <p className="text-3xl font-light">
          {Math.round(s.pressureHpa)}
          <span className="ml-1 text-sm text-white/60">hPa</span>
        </p>
        <p className="mt-auto text-xs text-white/60">
          {s.pressureHpa < 1005
            ? m.details.pressureLow
            : s.pressureHpa > 1020
              ? m.details.pressureHigh
              : m.details.pressureNormal}
        </p>
      </Tile>

      <Tile icon={<Eye className="size-3.5" />} label={m.details.visibility} index={9}>
        <p className="text-3xl font-light">
          {s.visibilityKm >= 10 ? Math.round(s.visibilityKm) : s.visibilityKm}
          <span className="ml-1 text-sm text-white/60">{m.units.km}</span>
        </p>
        <p className="mt-auto text-xs text-white/60">{m.details.cloudCover(s.cloudCover)}</p>
      </Tile>

      <Tile icon={<Sunrise className="size-3.5" />} label={m.details.sun} index={10}>
        <svg viewBox="0 0 120 60" className="h-auto w-full" aria-hidden>
          <path d="M10 52 Q60 -28 110 52" fill="none" stroke="rgba(255,255,255,0.25)" strokeDasharray="3 4" />
          <line x1="4" x2="116" y1="52" y2="52" stroke="rgba(255,255,255,0.2)" />
          {rise && set && now >= rise && now <= set && (
            <circle cx={arcX} cy={arcY} r="5" fill="#fcd34d" style={{ filter: "drop-shadow(0 0 6px #fcd34d)" }} />
          )}
        </svg>
        <div className="mt-auto flex justify-between text-xs text-white/70">
          <span>{current.sunrise ? f.clock(current.sunrise, tz) : "—"}</span>
          <span>{current.sunset ? f.clock(current.sunset, tz) : "—"}</span>
        </div>
      </Tile>
    </div>
  );
}
