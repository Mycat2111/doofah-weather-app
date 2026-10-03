"use client";

import { LoaderCircle } from "lucide-react";
import { CycloneIcon } from "@/components/ui/CycloneIcon";
import { TapButton } from "@/components/ui/TapButton";
import type { CycloneState } from "@/hooks/useCyclones";
import { useI18n } from "@/i18n/I18nProvider";
import { categoryOf, distanceKm, stormAt, type Cyclone, type GeoPoint } from "@/lib/cyclones";
import { CATEGORY_COLOR } from "./cycloneStyle";

/** Storms listed at most; more are rare and still drawn. */
const LISTED = 3;

interface CycloneStatusProps {
  state: CycloneState;
  /** Storms whose path or cone comes near the place. */
  nearby: Cyclone[];
  /** Active storms elsewhere in the world. */
  elsewhere: number;
  place: GeoPoint;
  now: number;
  onPick: (storm: Cyclone) => void;
}

/** Under the layer picker while storm tracks show: the storms near the place (tap to see one), or that there are none. */
export function CycloneStatus({ state, nearby, elsewhere, place, now, onPick }: CycloneStatusProps) {
  const { m } = useI18n();
  const pill =
    "glass-dark pointer-events-auto flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] text-white/85";
  // Clear of the zoom buttons on the right; 100cqw is the overlay's width inside its padding.
  const width = "max-w-[calc(100cqw-3.5rem)]";

  if (!state.feed) {
    return (
      <p role="status" className={`${pill} ${width}`}>
        {state.error ? (
          <CycloneIcon className="size-3.5 shrink-0 text-rose-200" aria-hidden />
        ) : (
          <LoaderCircle className="size-3.5 shrink-0 animate-spin text-rose-200" aria-hidden />
        )}
        {state.error ? m.cyclones.unavailable : m.cyclones.loading}
      </p>
    );
  }

  if (!nearby.length) {
    return (
      <p role="status" className={`${pill} ${width}`}>
        <CycloneIcon className="size-3.5 shrink-0 text-white/60" aria-hidden />
        <span>
          {m.cyclones.none}
          {elsewhere > 0 && <span className="text-white/55"> · {m.cyclones.elsewhere(elsewhere)}</span>}
        </span>
      </p>
    );
  }

  return (
    <ul className={`flex flex-wrap gap-1.5 ${width}`}>
      {nearby.slice(0, LISTED).map((storm) => {
        const at = stormAt(storm, now) ?? storm.track[0];
        const category = categoryOf(at.wind_kmh, storm.basin);
        const km = Math.round(distanceKm(at, place) / 10) * 10;
        return (
          <li key={storm.id} className="max-w-full">
            <TapButton
              haptic="light"
              onClick={() => onPick(storm)}
              className={`${pill} max-w-full font-medium hover:text-white`}
            >
              <CycloneIcon className="size-3.5 shrink-0" style={{ color: CATEGORY_COLOR[category] }} aria-hidden />
              <span className="truncate">
                {m.cyclones.storm(m.cyclones.category[category], storm.name ?? storm.id)}
              </span>
              <span className="shrink-0 whitespace-nowrap text-white/60">
                · {km} {m.units.km}
              </span>
              {/* Phones leave out the tag so the name fits; the storm's details still say it. */}
              {state.feed?.demo && (
                <span className="shrink-0 whitespace-nowrap rounded-full bg-white/15 px-1.5 text-[10px] max-[447px]:hidden">
                  {m.cyclones.demo}
                </span>
              )}
            </TapButton>
          </li>
        );
      })}
    </ul>
  );
}
