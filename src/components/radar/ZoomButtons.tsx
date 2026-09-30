"use client";

import type { Map as LeafletMap } from "leaflet";
import { Minus, Plus } from "lucide-react";
import { useCallback, useSyncExternalStore } from "react";
import { TapButton } from "@/components/ui/TapButton";
import { useI18n } from "@/i18n/I18nProvider";

/** Zoom buttons in the app's glass style, with finger-sized targets on touch screens. */
export function ZoomButtons({ map, className = "" }: { map: LeafletMap | null; className?: string }) {
  const { m } = useI18n();
  const subscribe = useCallback(
    (onChange: () => void) => {
      map?.on("zoomend", onChange);
      return () => {
        map?.off("zoomend", onChange);
      };
    },
    [map],
  );
  const zoom = useSyncExternalStore(
    subscribe,
    () => map?.getZoom() ?? null,
    () => null,
  );
  if (!map || zoom === null) return null;

  const buttons = [
    { id: "in", label: m.radar.zoomIn, Icon: Plus, disabled: zoom >= map.getMaxZoom(), zoom: () => map.zoomIn() },
    { id: "out", label: m.radar.zoomOut, Icon: Minus, disabled: zoom <= map.getMinZoom(), zoom: () => map.zoomOut() },
  ];

  return (
    <div className={`glass-dark flex flex-col overflow-hidden rounded-2xl shadow-lg ${className}`}>
      {buttons.map(({ id, label, Icon, disabled, zoom: onClick }, i) => (
        <div key={id} className={i > 0 ? "border-t border-white/12" : ""}>
          <TapButton
            haptic="light"
            tapScale={0.82}
            onClick={onClick}
            disabled={disabled}
            aria-label={label}
            title={label}
            className="grid size-10 place-items-center text-white transition-colors hover:bg-white/12 disabled:text-white/30 disabled:hover:bg-transparent pointer-coarse:size-11"
          >
            <Icon className="size-[18px]" aria-hidden />
          </TapButton>
        </div>
      ))}
    </div>
  );
}
