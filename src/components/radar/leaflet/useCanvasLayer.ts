"use client";

import L from "leaflet";
import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";

export interface CanvasHandle {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** CSS pixel size of the map viewport. */
  width: number;
  height: number;
  /** Lat/lon to canvas CSS pixels. Stays valid while the map is dragged. */
  project: (lat: number, lon: number) => { x: number; y: number };
  /** Canvas CSS pixels back to lat/lon. */
  unproject: (x: number, y: number) => { lat: number; lon: number };
  /** Ask the owner to paint again (e.g. new data). */
  redraw: () => void;
  zoom: number;
}

export type CanvasRender = (handle: CanvasHandle, reason: "reset" | "update") => void;

/**
 * A full-viewport canvas in its own Leaflet pane. It is re-anchored and
 * repainted after every pan, zoom or resize, hidden during zoom animations,
 * and painted in layer coordinates so it moves with the map while dragging.
 */
export function useCanvasLayer(paneName: string, zIndex: number, render: CanvasRender) {
  const map = useMap();
  const renderRef = useRef(render);
  const handleRef = useRef<CanvasHandle | null>(null);

  useEffect(() => {
    renderRef.current = render;
  });

  useEffect(() => {
    const pane = map.getPane(paneName) ?? map.createPane(paneName);
    pane.style.zIndex = String(zIndex);
    pane.style.pointerEvents = "none";

    const canvas = L.DomUtil.create("canvas", "doofah-canvas-layer leaflet-zoom-hide", pane) as HTMLCanvasElement;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let origin = L.point(0, 0);
    const handle: CanvasHandle = {
      canvas,
      ctx,
      width: 0,
      height: 0,
      zoom: map.getZoom(),
      project: (lat, lon) => {
        const p = map.latLngToLayerPoint([lat, lon]);
        return { x: p.x - origin.x, y: p.y - origin.y };
      },
      unproject: (x, y) => {
        const ll = map.layerPointToLatLng(L.point(x + origin.x, y + origin.y));
        return { lat: ll.lat, lon: ll.lng };
      },
      redraw: () => renderRef.current(handle, "update"),
    };

    const reset = () => {
      const size = map.getSize();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(size.x * dpr);
      canvas.height = Math.round(size.y * dpr);
      canvas.style.width = `${size.x}px`;
      canvas.style.height = `${size.y}px`;
      origin = map.containerPointToLayerPoint([0, 0]);
      L.DomUtil.setPosition(canvas, origin);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      handle.width = size.x;
      handle.height = size.y;
      handle.zoom = map.getZoom();
      renderRef.current(handle, "reset");
    };

    map.on("moveend resize viewreset", reset);
    reset();
    handleRef.current = handle;

    return () => {
      map.off("moveend resize viewreset", reset);
      canvas.remove();
      handleRef.current = null;
    };
  }, [map, paneName, zIndex]);

  return handleRef;
}
