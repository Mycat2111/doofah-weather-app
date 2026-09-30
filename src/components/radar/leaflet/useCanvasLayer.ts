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
  /**
   * Lat/lon to canvas CSS pixels. Fixed to the view of the last reset, so it
   * stays valid while the map is dragged or zoomed until the next repaint.
   */
  project: (lat: number, lon: number) => { x: number; y: number };
  /** Canvas CSS pixels back to lat/lon. */
  unproject: (x: number, y: number) => { lat: number; lon: number };
  /** Ask the owner to paint again (e.g. new data). */
  redraw: () => void;
  zoom: number;
}

export type CanvasRender = (handle: CanvasHandle, reason: "reset" | "update") => void;

/** Leaflet's own renderers use this to follow zoom animations; it is not in the public types. */
interface LeafletMapInternals extends L.Map {
  _getNewPixelOrigin(center: L.LatLng, zoom: number): L.Point;
}

/**
 * A full-viewport canvas in its own Leaflet pane. It is re-anchored and
 * repainted after every pan, zoom or resize. In between, the last painting
 * moves with the map while dragging and is scaled with it while zooming
 * (pinch, double tap, buttons, fly-to), the way Leaflet's own vector
 * renderers do, so the weather never slides off the base map.
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

    // "leaflet-zoom-animated" lets Leaflet's zoom transition apply to the canvas.
    const canvas = L.DomUtil.create("canvas", "doofah-canvas-layer leaflet-zoom-animated", pane) as HTMLCanvasElement;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // The view the canvas was last painted for.
    let origin = L.point(0, 0);
    let anchorCenter = map.getCenter();
    let anchorZoom = map.getZoom();
    let anchorPixelOrigin = map.getPixelOrigin();

    const handle: CanvasHandle = {
      canvas,
      ctx,
      width: 0,
      height: 0,
      zoom: anchorZoom,
      project: (lat, lon) => {
        const p = map.project([lat, lon], anchorZoom).subtract(anchorPixelOrigin);
        return { x: p.x - origin.x, y: p.y - origin.y };
      },
      unproject: (x, y) => {
        const ll = map.unproject(L.point(x + origin.x, y + origin.y).add(anchorPixelOrigin), anchorZoom);
        return { lat: ll.lat, lon: ll.lng };
      },
      redraw: () => renderRef.current(handle, "update"),
    };

    /** Scale and shift the last painting to where the map is heading. */
    const follow = (center: L.LatLng, zoom: number) => {
      const scale = map.getZoomScale(zoom, anchorZoom);
      const offset = map
        .getSize()
        .multiplyBy(-0.5 * scale)
        .add(map.project(anchorCenter, zoom))
        .subtract((map as LeafletMapInternals)._getNewPixelOrigin(center, zoom));
      L.DomUtil.setTransform(canvas, offset, scale);
    };
    const onZoom = () => follow(map.getCenter(), map.getZoom());
    const onZoomAnim = (e: L.ZoomAnimEvent) => follow(e.center, e.zoom);

    const reset = () => {
      const size = map.getSize();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(size.x * dpr);
      canvas.height = Math.round(size.y * dpr);
      canvas.style.width = `${size.x}px`;
      canvas.style.height = `${size.y}px`;
      origin = map.containerPointToLayerPoint([0, 0]);
      anchorCenter = map.getCenter();
      anchorZoom = map.getZoom();
      anchorPixelOrigin = map.getPixelOrigin();
      L.DomUtil.setTransform(canvas, origin, 1);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      handle.width = size.x;
      handle.height = size.y;
      handle.zoom = anchorZoom;
      renderRef.current(handle, "reset");
    };

    map.on("moveend resize viewreset", reset);
    map.on("zoom", onZoom);
    map.on("zoomanim", onZoomAnim);
    reset();
    handleRef.current = handle;

    return () => {
      map.off("moveend resize viewreset", reset);
      map.off("zoom", onZoom);
      map.off("zoomanim", onZoomAnim);
      canvas.remove();
      handleRef.current = null;
    };
  }, [map, paneName, zIndex]);

  return handleRef;
}
