import type { GeoPoint, Place } from "./types";

/** Small offline gazetteer so search works with no geocoding API key. */
export const PLACES: Place[] = [
  { id: "bangkok", name: "Bangkok", localName: "กรุงเทพฯ", country: "Thailand", point: { lat: 13.7563, lon: 100.5018 }, timeZone: "Asia/Bangkok" },
  { id: "chiang-mai", name: "Chiang Mai", localName: "เชียงใหม่", country: "Thailand", point: { lat: 18.7883, lon: 98.9853 }, timeZone: "Asia/Bangkok" },
  { id: "chiang-rai", name: "Chiang Rai", localName: "เชียงราย", country: "Thailand", point: { lat: 19.9105, lon: 99.8406 }, timeZone: "Asia/Bangkok" },
  { id: "phuket", name: "Phuket", localName: "ภูเก็ต", country: "Thailand", point: { lat: 7.8804, lon: 98.3923 }, timeZone: "Asia/Bangkok" },
  { id: "pattaya", name: "Pattaya", localName: "พัทยา", region: "Chon Buri", country: "Thailand", point: { lat: 12.9236, lon: 100.8825 }, timeZone: "Asia/Bangkok" },
  { id: "hua-hin", name: "Hua Hin", localName: "หัวหิน", region: "Prachuap Khiri Khan", country: "Thailand", point: { lat: 12.5684, lon: 99.9577 }, timeZone: "Asia/Bangkok" },
  { id: "khon-kaen", name: "Khon Kaen", localName: "ขอนแก่น", country: "Thailand", point: { lat: 16.4322, lon: 102.8236 }, timeZone: "Asia/Bangkok" },
  { id: "udon-thani", name: "Udon Thani", localName: "อุดรธานี", country: "Thailand", point: { lat: 17.4138, lon: 102.787 }, timeZone: "Asia/Bangkok" },
  { id: "korat", name: "Nakhon Ratchasima", localName: "นครราชสีมา", country: "Thailand", point: { lat: 14.9799, lon: 102.0978 }, timeZone: "Asia/Bangkok" },
  { id: "ayutthaya", name: "Ayutthaya", localName: "อยุธยา", country: "Thailand", point: { lat: 14.3532, lon: 100.5689 }, timeZone: "Asia/Bangkok" },
  { id: "hat-yai", name: "Hat Yai", localName: "หาดใหญ่", region: "Songkhla", country: "Thailand", point: { lat: 7.0086, lon: 100.4747 }, timeZone: "Asia/Bangkok" },
  { id: "krabi", name: "Krabi", localName: "กระบี่", country: "Thailand", point: { lat: 8.0863, lon: 98.9063 }, timeZone: "Asia/Bangkok" },
  { id: "koh-samui", name: "Koh Samui", localName: "เกาะสมุย", region: "Surat Thani", country: "Thailand", point: { lat: 9.512, lon: 100.0136 }, timeZone: "Asia/Bangkok" },
  { id: "singapore", name: "Singapore", country: "Singapore", point: { lat: 1.3521, lon: 103.8198 }, timeZone: "Asia/Singapore" },
  { id: "kuala-lumpur", name: "Kuala Lumpur", country: "Malaysia", point: { lat: 3.139, lon: 101.6869 }, timeZone: "Asia/Kuala_Lumpur" },
  { id: "hanoi", name: "Hanoi", localName: "Hà Nội", country: "Vietnam", point: { lat: 21.0278, lon: 105.8342 }, timeZone: "Asia/Ho_Chi_Minh" },
  { id: "ho-chi-minh", name: "Ho Chi Minh City", country: "Vietnam", point: { lat: 10.8231, lon: 106.6297 }, timeZone: "Asia/Ho_Chi_Minh" },
  { id: "vientiane", name: "Vientiane", country: "Laos", point: { lat: 17.9757, lon: 102.6331 }, timeZone: "Asia/Vientiane" },
  { id: "phnom-penh", name: "Phnom Penh", country: "Cambodia", point: { lat: 11.5564, lon: 104.9282 }, timeZone: "Asia/Phnom_Penh" },
  { id: "yangon", name: "Yangon", country: "Myanmar", point: { lat: 16.8409, lon: 96.1735 }, timeZone: "Asia/Yangon" },
  { id: "manila", name: "Manila", country: "Philippines", point: { lat: 14.5995, lon: 120.9842 }, timeZone: "Asia/Manila" },
  { id: "jakarta", name: "Jakarta", country: "Indonesia", point: { lat: -6.2088, lon: 106.8456 }, timeZone: "Asia/Jakarta" },
  { id: "hong-kong", name: "Hong Kong", country: "China", point: { lat: 22.3193, lon: 114.1694 }, timeZone: "Asia/Hong_Kong" },
  { id: "taipei", name: "Taipei", country: "Taiwan", point: { lat: 25.033, lon: 121.5654 }, timeZone: "Asia/Taipei" },
  { id: "tokyo", name: "Tokyo", localName: "東京", country: "Japan", point: { lat: 35.6762, lon: 139.6503 }, timeZone: "Asia/Tokyo" },
  { id: "seoul", name: "Seoul", localName: "서울", country: "South Korea", point: { lat: 37.5665, lon: 126.978 }, timeZone: "Asia/Seoul" },
  { id: "mumbai", name: "Mumbai", country: "India", point: { lat: 19.076, lon: 72.8777 }, timeZone: "Asia/Kolkata" },
  { id: "dubai", name: "Dubai", country: "United Arab Emirates", point: { lat: 25.2048, lon: 55.2708 }, timeZone: "Asia/Dubai" },
  { id: "sydney", name: "Sydney", country: "Australia", point: { lat: -33.8688, lon: 151.2093 }, timeZone: "Australia/Sydney" },
  { id: "london", name: "London", country: "United Kingdom", point: { lat: 51.5072, lon: -0.1276 }, timeZone: "Europe/London" },
  { id: "paris", name: "Paris", country: "France", point: { lat: 48.8566, lon: 2.3522 }, timeZone: "Europe/Paris" },
  { id: "berlin", name: "Berlin", country: "Germany", point: { lat: 52.52, lon: 13.405 }, timeZone: "Europe/Berlin" },
  { id: "reykjavik", name: "Reykjavík", country: "Iceland", point: { lat: 64.1466, lon: -21.9426 }, timeZone: "Atlantic/Reykjavik" },
  { id: "new-york", name: "New York", country: "United States", point: { lat: 40.7128, lon: -74.006 }, timeZone: "America/New_York" },
  { id: "chicago", name: "Chicago", country: "United States", point: { lat: 41.8781, lon: -87.6298 }, timeZone: "America/Chicago" },
  { id: "san-francisco", name: "San Francisco", country: "United States", point: { lat: 37.7749, lon: -122.4194 }, timeZone: "America/Los_Angeles" },
  { id: "vancouver", name: "Vancouver", country: "Canada", point: { lat: 49.2827, lon: -123.1207 }, timeZone: "America/Vancouver" },
  { id: "sao-paulo", name: "São Paulo", country: "Brazil", point: { lat: -23.5505, lon: -46.6333 }, timeZone: "America/Sao_Paulo" },
  { id: "cape-town", name: "Cape Town", country: "South Africa", point: { lat: -33.9249, lon: 18.4241 }, timeZone: "Africa/Johannesburg" },
];

export const DEFAULT_PLACE: Place = PLACES[0];

const normalise = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

export function searchPlaces(query: string, limit = 6): Place[] {
  const q = normalise(query);
  if (!q) return [];
  const scored: { place: Place; score: number }[] = [];
  for (const place of PLACES) {
    const names = [place.name, place.localName, place.region, place.country]
      .filter((n): n is string => Boolean(n))
      .map(normalise);
    let score = 0;
    names.forEach((n, i) => {
      const weight = i < 2 ? 1 : 0.5;
      if (n === q) score = Math.max(score, 3 * weight);
      else if (n.startsWith(q)) score = Math.max(score, 2 * weight);
      else if (n.includes(q)) score = Math.max(score, 1 * weight);
    });
    if (score > 0) scored.push({ place, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.place.name.localeCompare(b.place.name))
    .slice(0, limit)
    .map((s) => s.place);
}

/** Great-circle distance in km. */
export function distanceKm(a: GeoPoint, b: GeoPoint): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Turn raw coordinates into a Place: the nearest known city when within
 * 40 km, otherwise a coordinate label in the caller's time zone.
 */
export function placeForPoint(point: GeoPoint, fallbackTimeZone: string): Place {
  let best: Place | null = null;
  let bestKm = Infinity;
  for (const place of PLACES) {
    const km = distanceKm(point, place.point);
    if (km < bestKm) {
      best = place;
      bestKm = km;
    }
  }
  if (best && bestKm <= 40) {
    return { ...best, id: `${best.id}@${point.lat.toFixed(3)},${point.lon.toFixed(3)}`, point };
  }
  const ns = point.lat >= 0 ? "N" : "S";
  const ew = point.lon >= 0 ? "E" : "W";
  return {
    id: `pt@${point.lat.toFixed(3)},${point.lon.toFixed(3)}`,
    name: "Your location",
    region: `${Math.abs(point.lat).toFixed(2)}°${ns}, ${Math.abs(point.lon).toFixed(2)}°${ew}`,
    country: best ? `near ${best.name}` : "",
    point,
    timeZone: fallbackTimeZone,
  };
}
