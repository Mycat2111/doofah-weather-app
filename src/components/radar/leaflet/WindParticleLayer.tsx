"use client";

import { useEffect, useRef } from "react";
import { sampleGrid } from "@/services/weather/grid";
import type { RadarGridSpec } from "@/services/weather/types";
import { useCanvasLayer, type CanvasHandle } from "./useCanvasLayer";

interface WindParticleLayerProps {
  grid: RadarGridSpec;
  u: Float32Array;
  v: Float32Array;
}

interface Particle {
  x: number;
  y: number;
  age: number;
  maxAge: number;
}

/** Screen pixels travelled per animation frame for each km/h of wind. */
const PX_PER_KMH = 0.05;

/**
 * Animated streamlines: particles drift with the interpolated 10 m wind and
 * leave fading trails, coloured by speed.
 */
export function WindParticleLayer({ grid, u, v }: WindParticleLayerProps) {
  const field = useRef({ grid, u, v });
  const particles = useRef<Particle[]>([]);

  const spawn = (h: CanvasHandle, p?: Particle): Particle => {
    const next = p ?? { x: 0, y: 0, age: 0, maxAge: 0 };
    next.x = Math.random() * h.width;
    next.y = Math.random() * h.height;
    next.age = 0;
    next.maxAge = 40 + Math.random() * 70;
    return next;
  };

  const handle = useCanvasLayer("doofah-wind", 360, (h, reason) => {
    if (reason !== "reset") return;
    h.ctx.clearRect(0, 0, h.width, h.height);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const count = Math.min(reduced ? 500 : 2200, Math.round((h.width * h.height) / (reduced ? 2600 : 900)));
    particles.current = Array.from({ length: count }, () => {
      const p = spawn(h);
      p.age = Math.random() * p.maxAge;
      return p;
    });
  });

  useEffect(() => {
    field.current = { grid, u, v };
  }, [grid, u, v]);

  useEffect(() => {
    let raf = 0;
    const step = () => {
      raf = requestAnimationFrame(step);
      const h = handle.current;
      if (!h) return;
      const { ctx } = h;
      const { grid: g, u: fu, v: fv } = field.current;

      // Fade existing trails.
      ctx.save();
      ctx.globalCompositeOperation = "destination-in";
      ctx.fillStyle = "rgba(0, 0, 0, 0.9)";
      ctx.fillRect(0, 0, h.width, h.height);
      ctx.restore();

      ctx.lineWidth = 1.3;
      ctx.lineCap = "round";
      const buckets: number[][] = [[], [], [], []];

      for (const p of particles.current) {
        const ll = h.unproject(p.x, p.y);
        const wu = sampleGrid(g, fu, ll.lat, ll.lon);
        const wv = sampleGrid(g, fv, ll.lat, ll.lon);
        if (Number.isNaN(wu) || Number.isNaN(wv) || ++p.age > p.maxAge) {
          spawn(h, p);
          continue;
        }
        const nx = p.x + wu * PX_PER_KMH;
        const ny = p.y - wv * PX_PER_KMH;
        const speed = Math.hypot(wu, wv);
        const bucket = speed < 12 ? 0 : speed < 25 ? 1 : speed < 45 ? 2 : 3;
        buckets[bucket].push(p.x, p.y, nx, ny);
        p.x = nx;
        p.y = ny;
        if (nx < 0 || ny < 0 || nx > h.width || ny > h.height) spawn(h, p);
      }

      const colors = [
        "rgba(255, 255, 255, 0.45)",
        "rgba(210, 245, 255, 0.7)",
        "rgba(190, 255, 220, 0.85)",
        "rgba(255, 230, 150, 0.95)",
      ];
      buckets.forEach((segs, i) => {
        if (!segs.length) return;
        ctx.strokeStyle = colors[i];
        ctx.beginPath();
        for (let k = 0; k < segs.length; k += 4) {
          ctx.moveTo(segs[k], segs[k + 1]);
          ctx.lineTo(segs[k + 2], segs[k + 3]);
        }
        ctx.stroke();
      });
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [handle]);

  return null;
}
