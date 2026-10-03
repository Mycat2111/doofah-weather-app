import type { CycloneCategory } from "@/lib/cyclones";

/** Storm path and marker colours: blue for a depression, amber for a tropical storm, rose at full strength. */
export const CATEGORY_COLOR: Record<CycloneCategory, string> = {
  depression: "#7dd3fc",
  storm: "#fcd34d",
  typhoon: "#fb7185",
  hurricane: "#fb7185",
  cyclone: "#fb7185",
};
