"use client";

import { useEffect, useMemo } from "react";
import type { RadarGridSpec } from "@/services/weather/types";
import { computeIsobars } from "../isobars";
import { useCanvasLayer } from "./useCanvasLayer";

interface IsobarLayerProps {
  grid: RadarGridSpec;
  pressure: Float32Array;
}

/** Isobar lines with value labels and H / L pressure centres. */
export function IsobarLayer({ grid, pressure }: IsobarLayerProps) {
  const isobars = useMemo(() => computeIsobars(grid, pressure), [grid, pressure]);

  const handle = useCanvasLayer("doofah-isobars", 370, (h) => {
    const { ctx } = h;
    ctx.clearRect(0, 0, h.width, h.height);
    const labels: { x: number; y: number }[] = [];
    const farFromLabels = (x: number, y: number) => labels.every((l) => Math.hypot(l.x - x, l.y - y) > 150);

    for (const level of isobars.levels) {
      const major = Math.round(level.value) % (isobars.interval * 2) === 0;
      ctx.strokeStyle = major ? "rgba(255, 255, 255, 0.85)" : "rgba(255, 255, 255, 0.5)";
      ctx.lineWidth = major ? 1.6 : 1.1;
      ctx.beginPath();
      for (const [lat1, lon1, lat2, lon2] of level.segments) {
        const a = h.project(lat1, lon1);
        const b = h.project(lat2, lon2);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();

      // Up to three labels per isobar, spread across the view.
      let placed = 0;
      for (let i = 0; i < level.segments.length && placed < 3; i += 7) {
        const [lat1, lon1, lat2, lon2] = level.segments[i];
        const m = h.project((lat1 + lat2) / 2, (lon1 + lon2) / 2);
        if (m.x < 40 || m.y < 40 || m.x > h.width - 40 || m.y > h.height - 90) continue;
        if (!farFromLabels(m.x, m.y)) continue;
        labels.push(m);
        placed++;
        const text = String(Math.round(level.value));
        ctx.font = "600 11px system-ui, sans-serif";
        const w = ctx.measureText(text).width + 10;
        ctx.fillStyle = "rgba(10, 14, 30, 0.72)";
        ctx.beginPath();
        ctx.roundRect(m.x - w / 2, m.y - 9, w, 18, 9);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(text, m.x, m.y + 0.5);
      }
    }

    for (const c of isobars.centers) {
      const p = h.project(c.lat, c.lon);
      if (p.x < 0 || p.y < 0 || p.x > h.width || p.y > h.height) continue;
      ctx.font = "700 26px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = c.kind === "H" ? "#fca5a5" : "#93c5fd";
      ctx.shadowColor = "rgba(0,0,0,0.5)";
      ctx.shadowBlur = 8;
      ctx.fillText(c.kind, p.x, p.y);
      ctx.shadowBlur = 0;
      ctx.font = "500 11px system-ui, sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.fillText(String(Math.round(c.value)), p.x, p.y + 20);
    }
  });

  useEffect(() => {
    handle.current?.redraw();
  }, [handle, isobars]);

  return null;
}
