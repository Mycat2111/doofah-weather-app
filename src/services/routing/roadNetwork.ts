import { PLACES } from "../weathernext3/places";
import type { GeoPoint } from "../weathernext3/types";

/**
 * A small, hand-made map of the main highways of Thailand and the roads that
 * cross into its neighbours, for the simulated router. Towns sit roughly on
 * the real highway junctions, so a simulated Bangkok to Chiang Mai trip runs
 * up Highway 1 and 11 like the real one does.
 */

export interface Town {
  id: string;
  name: string;
  /** Thai name. */
  th: string;
  point: GeoPoint;
}

export type RoadKind = "motorway" | "highway" | "road" | "mountain" | "ferry";

export interface Road {
  from: string;
  to: string;
  kind: RoadKind;
  /** The road crosses a border (a passport check on the way). */
  border?: boolean;
}

/** Towns on the network that are not already in the place list. */
const JUNCTIONS: Town[] = [
  { id: "saraburi", name: "Saraburi", th: "สระบุรี", point: { lat: 14.5289, lon: 100.9108 } },
  { id: "nakhon-sawan", name: "Nakhon Sawan", th: "นครสวรรค์", point: { lat: 15.7047, lon: 100.1372 } },
  { id: "phitsanulok", name: "Phitsanulok", th: "พิษณุโลก", point: { lat: 16.8211, lon: 100.2659 } },
  { id: "kamphaeng-phet", name: "Kamphaeng Phet", th: "กำแพงเพชร", point: { lat: 16.4827, lon: 99.5227 } },
  { id: "tak", name: "Tak", th: "ตาก", point: { lat: 16.884, lon: 99.1259 } },
  { id: "mae-sot", name: "Mae Sot", th: "แม่สอด", point: { lat: 16.7131, lon: 98.5747 } },
  { id: "uttaradit", name: "Uttaradit", th: "อุตรดิตถ์", point: { lat: 17.62, lon: 100.0993 } },
  { id: "den-chai", name: "Den Chai", th: "เด่นชัย", point: { lat: 17.9833, lon: 100.05 } },
  { id: "lampang", name: "Lampang", th: "ลำปาง", point: { lat: 18.2888, lon: 99.4908 } },
  { id: "lamphun", name: "Lamphun", th: "ลำพูน", point: { lat: 18.5745, lon: 99.0087 } },
  { id: "phayao", name: "Phayao", th: "พะเยา", point: { lat: 19.1666, lon: 99.9019 } },
  { id: "wiang-pa-pao", name: "Wiang Pa Pao", th: "เวียงป่าเป้า", point: { lat: 19.35, lon: 99.5083 } },
  { id: "chon-buri", name: "Chon Buri", th: "ชลบุรี", point: { lat: 13.3611, lon: 100.9847 } },
  { id: "phetchaburi", name: "Phetchaburi", th: "เพชรบุรี", point: { lat: 13.1112, lon: 99.9391 } },
  { id: "prachuap", name: "Prachuap Khiri Khan", th: "ประจวบคีรีขันธ์", point: { lat: 11.8124, lon: 99.7973 } },
  { id: "chumphon", name: "Chumphon", th: "ชุมพร", point: { lat: 10.493, lon: 99.18 } },
  { id: "surat-thani", name: "Surat Thani", th: "สุราษฎร์ธานี", point: { lat: 9.1382, lon: 99.3215 } },
  { id: "don-sak", name: "Don Sak pier", th: "ท่าเรือดอนสัก", point: { lat: 9.316, lon: 99.689 } },
  { id: "phang-nga", name: "Phang Nga", th: "พังงา", point: { lat: 8.4509, lon: 98.5298 } },
  { id: "thung-song", name: "Thung Song", th: "ทุ่งสง", point: { lat: 8.164, lon: 99.68 } },
  { id: "phatthalung", name: "Phatthalung", th: "พัทลุง", point: { lat: 7.6167, lon: 100.074 } },
  { id: "sadao", name: "Sadao", th: "สะเดา", point: { lat: 6.639, lon: 100.424 } },
  { id: "alor-setar", name: "Alor Setar", th: "อลอร์สตาร์", point: { lat: 6.1248, lon: 100.3678 } },
  { id: "butterworth", name: "Butterworth", th: "บัตเตอร์เวิร์ท", point: { lat: 5.3991, lon: 100.3638 } },
  { id: "ipoh", name: "Ipoh", th: "อีโปห์", point: { lat: 4.5975, lon: 101.0901 } },
  { id: "seremban", name: "Seremban", th: "เซเรมบัน", point: { lat: 2.7297, lon: 101.9381 } },
  { id: "johor-bahru", name: "Johor Bahru", th: "ยะโฮร์บาห์รู", point: { lat: 1.4927, lon: 103.7414 } },
  { id: "pak-chong", name: "Pak Chong", th: "ปากช่อง", point: { lat: 14.708, lon: 101.416 } },
  { id: "nong-khai", name: "Nong Khai", th: "หนองคาย", point: { lat: 17.8783, lon: 102.742 } },
  { id: "paksan", name: "Paksan", th: "ปากซัน", point: { lat: 18.3833, lon: 103.65 } },
  { id: "lak-sao", name: "Lak Sao", th: "หลักซาว", point: { lat: 18.1833, lon: 104.9833 } },
  { id: "vinh", name: "Vinh", th: "วินห์", point: { lat: 18.6796, lon: 105.6813 } },
  { id: "thanh-hoa", name: "Thanh Hoa", th: "ทัญฮว้า", point: { lat: 19.8067, lon: 105.7852 } },
  { id: "prachinburi", name: "Prachin Buri", th: "ปราจีนบุรี", point: { lat: 14.05, lon: 101.37 } },
  { id: "sa-kaeo", name: "Sa Kaeo", th: "สระแก้ว", point: { lat: 13.824, lon: 102.0646 } },
  { id: "aranyaprathet", name: "Aranyaprathet", th: "อรัญประเทศ", point: { lat: 13.6936, lon: 102.5033 } },
  { id: "sisophon", name: "Sisophon", th: "ศรีโสภณ", point: { lat: 13.5859, lon: 102.9737 } },
  { id: "battambang", name: "Battambang", th: "พระตะบอง", point: { lat: 13.0957, lon: 103.2022 } },
  { id: "pursat", name: "Pursat", th: "โพธิสัตว์", point: { lat: 12.5388, lon: 103.9192 } },
  { id: "bavet", name: "Bavet", th: "บาเวต", point: { lat: 11.0667, lon: 106.1667 } },
  { id: "hpa-an", name: "Hpa-an", th: "ผาอัน", point: { lat: 16.8906, lon: 97.6333 } },
  { id: "bago", name: "Bago", th: "พะโค", point: { lat: 17.335, lon: 96.4814 } },
];

/** Places from the place list that sit on the network. */
const PLACE_TOWNS = [
  "bangkok",
  "ayutthaya",
  "chiang-mai",
  "chiang-rai",
  "pattaya",
  "hua-hin",
  "koh-samui",
  "phuket",
  "krabi",
  "hat-yai",
  "kuala-lumpur",
  "singapore",
  "korat",
  "khon-kaen",
  "udon-thani",
  "vientiane",
  "hanoi",
  "phnom-penh",
  "ho-chi-minh",
  "yangon",
];

export const TOWNS: Town[] = [
  ...PLACE_TOWNS.map((id) => {
    const place = PLACES.find((p) => p.id === id);
    if (!place) throw new Error(`Unknown place ${id}`);
    return { id, name: place.name, th: place.th?.name ?? place.name, point: place.point };
  }),
  ...JUNCTIONS,
];

const road = (from: string, to: string, kind: RoadKind, border = false): Road => ({ from, to, kind, border });

export const ROADS: Road[] = [
  // North: Highway 1, 32, 11 and 118.
  road("bangkok", "ayutthaya", "highway"),
  road("ayutthaya", "saraburi", "road"),
  road("bangkok", "saraburi", "highway"),
  road("ayutthaya", "nakhon-sawan", "highway"),
  road("nakhon-sawan", "phitsanulok", "highway"),
  road("nakhon-sawan", "kamphaeng-phet", "highway"),
  road("kamphaeng-phet", "tak", "highway"),
  road("tak", "lampang", "mountain"),
  road("phitsanulok", "uttaradit", "highway"),
  road("uttaradit", "den-chai", "highway"),
  road("den-chai", "lampang", "road"),
  road("lampang", "lamphun", "mountain"),
  road("lamphun", "chiang-mai", "road"),
  road("lampang", "phayao", "mountain"),
  road("phayao", "chiang-rai", "highway"),
  road("chiang-mai", "wiang-pa-pao", "mountain"),
  road("wiang-pa-pao", "chiang-rai", "mountain"),
  // East: Motorway 7.
  road("bangkok", "chon-buri", "motorway"),
  road("chon-buri", "pattaya", "motorway"),
  // South: Highway 35, 4 and 41, the Sarasin bridge to Phuket, the Samui car ferry.
  road("bangkok", "phetchaburi", "highway"),
  road("phetchaburi", "hua-hin", "highway"),
  road("hua-hin", "prachuap", "highway"),
  road("prachuap", "chumphon", "highway"),
  road("chumphon", "surat-thani", "highway"),
  road("surat-thani", "don-sak", "road"),
  road("don-sak", "koh-samui", "ferry"),
  road("surat-thani", "phang-nga", "road"),
  road("phang-nga", "phuket", "highway"),
  road("phang-nga", "krabi", "road"),
  road("surat-thani", "krabi", "road"),
  road("surat-thani", "thung-song", "highway"),
  road("thung-song", "phatthalung", "highway"),
  road("phatthalung", "hat-yai", "highway"),
  // Malaysia's North-South Expressway to Singapore.
  road("hat-yai", "sadao", "highway"),
  road("sadao", "alor-setar", "motorway", true),
  road("alor-setar", "butterworth", "motorway"),
  road("butterworth", "ipoh", "motorway"),
  road("ipoh", "kuala-lumpur", "motorway"),
  road("kuala-lumpur", "seremban", "motorway"),
  road("seremban", "johor-bahru", "motorway"),
  road("johor-bahru", "singapore", "road", true),
  // Northeast: Highway 2 (Mittraphap), the Friendship Bridge, Laos and Vietnam.
  road("saraburi", "pak-chong", "highway"),
  road("pak-chong", "korat", "highway"),
  road("korat", "khon-kaen", "highway"),
  road("khon-kaen", "udon-thani", "highway"),
  road("udon-thani", "nong-khai", "highway"),
  road("nong-khai", "vientiane", "road", true),
  road("vientiane", "paksan", "road"),
  road("paksan", "lak-sao", "mountain"),
  road("lak-sao", "vinh", "mountain", true),
  road("vinh", "thanh-hoa", "highway"),
  road("thanh-hoa", "hanoi", "motorway"),
  // Cambodia and southern Vietnam.
  road("bangkok", "prachinburi", "highway"),
  road("prachinburi", "sa-kaeo", "highway"),
  road("sa-kaeo", "aranyaprathet", "highway"),
  road("aranyaprathet", "sisophon", "road", true),
  road("sisophon", "battambang", "road"),
  road("battambang", "pursat", "road"),
  road("pursat", "phnom-penh", "road"),
  road("phnom-penh", "bavet", "road"),
  road("bavet", "ho-chi-minh", "road", true),
  // Myanmar, over the Dawna range.
  road("tak", "mae-sot", "mountain"),
  road("mae-sot", "hpa-an", "mountain", true),
  road("hpa-an", "bago", "road"),
  road("bago", "yangon", "highway"),
];
