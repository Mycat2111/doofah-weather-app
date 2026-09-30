import type { GeoPoint, Place } from "./types";

/** Small offline gazetteer so search works with no geocoding API key. */
export const PLACES: Place[] = [
  { id: "bangkok", name: "Bangkok", localName: "กรุงเทพฯ", country: "Thailand", th: { name: "กรุงเทพฯ", country: "ไทย" }, aliases: ["กรุงเทพมหานคร", "กทม", "Krung Thep"], point: { lat: 13.7563, lon: 100.5018 }, timeZone: "Asia/Bangkok" },
  { id: "chiang-mai", name: "Chiang Mai", localName: "เชียงใหม่", country: "Thailand", th: { name: "เชียงใหม่", country: "ไทย" }, point: { lat: 18.7883, lon: 98.9853 }, timeZone: "Asia/Bangkok" },
  { id: "chiang-rai", name: "Chiang Rai", localName: "เชียงราย", country: "Thailand", th: { name: "เชียงราย", country: "ไทย" }, point: { lat: 19.9105, lon: 99.8406 }, timeZone: "Asia/Bangkok" },
  { id: "phuket", name: "Phuket", localName: "ภูเก็ต", country: "Thailand", th: { name: "ภูเก็ต", country: "ไทย" }, point: { lat: 7.8804, lon: 98.3923 }, timeZone: "Asia/Bangkok" },
  { id: "pattaya", name: "Pattaya", localName: "พัทยา", region: "Chon Buri", country: "Thailand", th: { name: "พัทยา", region: "ชลบุรี", country: "ไทย" }, point: { lat: 12.9236, lon: 100.8825 }, timeZone: "Asia/Bangkok" },
  { id: "hua-hin", name: "Hua Hin", localName: "หัวหิน", region: "Prachuap Khiri Khan", country: "Thailand", th: { name: "หัวหิน", region: "ประจวบคีรีขันธ์", country: "ไทย" }, point: { lat: 12.5684, lon: 99.9577 }, timeZone: "Asia/Bangkok" },
  { id: "khon-kaen", name: "Khon Kaen", localName: "ขอนแก่น", country: "Thailand", th: { name: "ขอนแก่น", country: "ไทย" }, point: { lat: 16.4322, lon: 102.8236 }, timeZone: "Asia/Bangkok" },
  { id: "udon-thani", name: "Udon Thani", localName: "อุดรธานี", country: "Thailand", th: { name: "อุดรธานี", country: "ไทย" }, aliases: ["Udon"], point: { lat: 17.4138, lon: 102.787 }, timeZone: "Asia/Bangkok" },
  { id: "korat", name: "Nakhon Ratchasima", localName: "นครราชสีมา", country: "Thailand", th: { name: "นครราชสีมา", country: "ไทย" }, aliases: ["โคราช", "Korat"], point: { lat: 14.9799, lon: 102.0978 }, timeZone: "Asia/Bangkok" },
  { id: "ayutthaya", name: "Ayutthaya", localName: "อยุธยา", country: "Thailand", th: { name: "อยุธยา", country: "ไทย" }, aliases: ["พระนครศรีอยุธยา"], point: { lat: 14.3532, lon: 100.5689 }, timeZone: "Asia/Bangkok" },
  { id: "hat-yai", name: "Hat Yai", localName: "หาดใหญ่", region: "Songkhla", country: "Thailand", th: { name: "หาดใหญ่", region: "สงขลา", country: "ไทย" }, point: { lat: 7.0086, lon: 100.4747 }, timeZone: "Asia/Bangkok" },
  { id: "krabi", name: "Krabi", localName: "กระบี่", country: "Thailand", th: { name: "กระบี่", country: "ไทย" }, point: { lat: 8.0863, lon: 98.9063 }, timeZone: "Asia/Bangkok" },
  { id: "koh-samui", name: "Koh Samui", localName: "เกาะสมุย", region: "Surat Thani", country: "Thailand", th: { name: "เกาะสมุย", region: "สุราษฎร์ธานี", country: "ไทย" }, aliases: ["สมุย", "Ko Samui", "Samui"], point: { lat: 9.512, lon: 100.0136 }, timeZone: "Asia/Bangkok" },
  { id: "singapore", name: "Singapore", country: "Singapore", th: { name: "สิงคโปร์", country: "สิงคโปร์" }, point: { lat: 1.3521, lon: 103.8198 }, timeZone: "Asia/Singapore" },
  { id: "kuala-lumpur", name: "Kuala Lumpur", country: "Malaysia", th: { name: "กัวลาลัมเปอร์", country: "มาเลเซีย" }, aliases: ["KL"], point: { lat: 3.139, lon: 101.6869 }, timeZone: "Asia/Kuala_Lumpur" },
  { id: "hanoi", name: "Hanoi", localName: "Hà Nội", country: "Vietnam", th: { name: "ฮานอย", country: "เวียดนาม" }, point: { lat: 21.0278, lon: 105.8342 }, timeZone: "Asia/Ho_Chi_Minh" },
  { id: "ho-chi-minh", name: "Ho Chi Minh City", country: "Vietnam", th: { name: "โฮจิมินห์", country: "เวียดนาม" }, aliases: ["ไซ่ง่อน", "Saigon"], point: { lat: 10.8231, lon: 106.6297 }, timeZone: "Asia/Ho_Chi_Minh" },
  { id: "vientiane", name: "Vientiane", country: "Laos", th: { name: "เวียงจันทน์", country: "ลาว" }, point: { lat: 17.9757, lon: 102.6331 }, timeZone: "Asia/Vientiane" },
  { id: "phnom-penh", name: "Phnom Penh", country: "Cambodia", th: { name: "พนมเปญ", country: "กัมพูชา" }, point: { lat: 11.5564, lon: 104.9282 }, timeZone: "Asia/Phnom_Penh" },
  { id: "yangon", name: "Yangon", country: "Myanmar", th: { name: "ย่างกุ้ง", country: "เมียนมา" }, aliases: ["Rangoon"], point: { lat: 16.8409, lon: 96.1735 }, timeZone: "Asia/Yangon" },
  { id: "manila", name: "Manila", country: "Philippines", th: { name: "มะนิลา", country: "ฟิลิปปินส์" }, point: { lat: 14.5995, lon: 120.9842 }, timeZone: "Asia/Manila" },
  { id: "jakarta", name: "Jakarta", country: "Indonesia", th: { name: "จาการ์ตา", country: "อินโดนีเซีย" }, point: { lat: -6.2088, lon: 106.8456 }, timeZone: "Asia/Jakarta" },
  { id: "hong-kong", name: "Hong Kong", country: "China", th: { name: "ฮ่องกง", country: "จีน" }, point: { lat: 22.3193, lon: 114.1694 }, timeZone: "Asia/Hong_Kong" },
  { id: "taipei", name: "Taipei", country: "Taiwan", th: { name: "ไทเป", country: "ไต้หวัน" }, point: { lat: 25.033, lon: 121.5654 }, timeZone: "Asia/Taipei" },
  { id: "tokyo", name: "Tokyo", localName: "東京", country: "Japan", th: { name: "โตเกียว", country: "ญี่ปุ่น" }, point: { lat: 35.6762, lon: 139.6503 }, timeZone: "Asia/Tokyo" },
  { id: "seoul", name: "Seoul", localName: "서울", country: "South Korea", th: { name: "โซล", country: "เกาหลีใต้" }, point: { lat: 37.5665, lon: 126.978 }, timeZone: "Asia/Seoul" },
  { id: "mumbai", name: "Mumbai", country: "India", th: { name: "มุมไบ", country: "อินเดีย" }, aliases: ["Bombay"], point: { lat: 19.076, lon: 72.8777 }, timeZone: "Asia/Kolkata" },
  { id: "dubai", name: "Dubai", country: "United Arab Emirates", th: { name: "ดูไบ", country: "สหรัฐอาหรับเอมิเรตส์" }, point: { lat: 25.2048, lon: 55.2708 }, timeZone: "Asia/Dubai" },
  { id: "sydney", name: "Sydney", country: "Australia", th: { name: "ซิดนีย์", country: "ออสเตรเลีย" }, point: { lat: -33.8688, lon: 151.2093 }, timeZone: "Australia/Sydney" },
  { id: "london", name: "London", country: "United Kingdom", th: { name: "ลอนดอน", country: "สหราชอาณาจักร" }, point: { lat: 51.5072, lon: -0.1276 }, timeZone: "Europe/London" },
  { id: "paris", name: "Paris", country: "France", th: { name: "ปารีส", country: "ฝรั่งเศส" }, point: { lat: 48.8566, lon: 2.3522 }, timeZone: "Europe/Paris" },
  { id: "berlin", name: "Berlin", country: "Germany", th: { name: "เบอร์ลิน", country: "เยอรมนี" }, point: { lat: 52.52, lon: 13.405 }, timeZone: "Europe/Berlin" },
  { id: "reykjavik", name: "Reykjavík", country: "Iceland", th: { name: "เรคยาวิก", country: "ไอซ์แลนด์" }, point: { lat: 64.1466, lon: -21.9426 }, timeZone: "Atlantic/Reykjavik" },
  { id: "new-york", name: "New York", country: "United States", th: { name: "นิวยอร์ก", country: "สหรัฐอเมริกา" }, aliases: ["NYC"], point: { lat: 40.7128, lon: -74.006 }, timeZone: "America/New_York" },
  { id: "chicago", name: "Chicago", country: "United States", th: { name: "ชิคาโก", country: "สหรัฐอเมริกา" }, point: { lat: 41.8781, lon: -87.6298 }, timeZone: "America/Chicago" },
  { id: "san-francisco", name: "San Francisco", country: "United States", th: { name: "ซานฟรานซิสโก", country: "สหรัฐอเมริกา" }, point: { lat: 37.7749, lon: -122.4194 }, timeZone: "America/Los_Angeles" },
  { id: "vancouver", name: "Vancouver", country: "Canada", th: { name: "แวนคูเวอร์", country: "แคนาดา" }, point: { lat: 49.2827, lon: -123.1207 }, timeZone: "America/Vancouver" },
  { id: "sao-paulo", name: "São Paulo", country: "Brazil", th: { name: "เซาเปาลู", country: "บราซิล" }, point: { lat: -23.5505, lon: -46.6333 }, timeZone: "America/Sao_Paulo" },
  { id: "cape-town", name: "Cape Town", country: "South Africa", th: { name: "เคปทาวน์", country: "แอฟริกาใต้" }, point: { lat: -33.9249, lon: 18.4241 }, timeZone: "Africa/Johannesburg" },
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
    // Names in any language count fully; regions and countries count half.
    const names = [place.name, place.localName, place.th?.name, ...(place.aliases ?? [])];
    const areas = [place.region, place.country, place.th?.region, place.th?.country];
    let score = 0;
    const consider = (candidates: (string | undefined)[], weight: number) => {
      for (const raw of candidates) {
        if (!raw) continue;
        const n = normalise(raw);
        if (n === q) score = Math.max(score, 3 * weight);
        else if (n.startsWith(q)) score = Math.max(score, 2 * weight);
        else if (n.includes(q)) score = Math.max(score, 1 * weight);
      }
    };
    consider(names, 1);
    consider(areas, 0.5);
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
  const coordinates = `${Math.abs(point.lat).toFixed(2)}°${ns}, ${Math.abs(point.lon).toFixed(2)}°${ew}`;
  return {
    id: `pt@${point.lat.toFixed(3)},${point.lon.toFixed(3)}`,
    name: "Your location",
    region: coordinates,
    country: best ? `near ${best.name}` : "",
    th: {
      name: "ตำแหน่งของคุณ",
      region: coordinates,
      country: best ? `ใกล้${best.th?.name ?? best.name}` : "",
    },
    point,
    timeZone: fallbackTimeZone,
  };
}
