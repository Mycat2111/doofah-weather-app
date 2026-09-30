import type { Place } from "@/services/weathernext3/types";
import type { Locale } from "./config";

export interface PlaceLabel {
  /** The place's name in the reader's language. */
  name: string;
  /** Its native-script name, shown smaller beside it in English (e.g. "กรุงเทพฯ"). */
  localName?: string;
  /** "Chon Buri, Thailand" / "ชลบุรี, ไทย" */
  area: string;
}

export function placeLabel(place: Place, locale: Locale): PlaceLabel {
  if (locale === "th" && place.th) {
    const { name, region, country } = place.th;
    return { name, area: [region, country].filter(Boolean).join(", ") };
  }
  return {
    name: place.name,
    localName: place.localName,
    area: [place.region, place.country].filter(Boolean).join(", "),
  };
}
