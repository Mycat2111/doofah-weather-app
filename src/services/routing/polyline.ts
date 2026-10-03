import type { GeoPoint } from "../weather/types";

/**
 * Decodes an encoded polyline (https://developers.google.com/maps/documentation/utilities/polylinealgorithm).
 * OSRM sends precision 6 with `geometries=polyline6`.
 */
export function decodePolyline(encoded: string, precision = 6): GeoPoint[] {
  const factor = 10 ** precision;
  const points: GeoPoint[] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  const next = () => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    lat += next();
    lon += next();
    points.push({ lat: lat / factor, lon: lon / factor });
  }
  return points;
}

export function encodePolyline(points: GeoPoint[], precision = 6): string {
  const factor = 10 ** precision;
  let out = "";
  let prevLat = 0;
  let prevLon = 0;
  const put = (value: number) => {
    let v = value < 0 ? ~(value << 1) : value << 1;
    while (v >= 0x20) {
      out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    out += String.fromCharCode(v + 63);
  };
  for (const p of points) {
    const lat = Math.round(p.lat * factor);
    const lon = Math.round(p.lon * factor);
    put(lat - prevLat);
    put(lon - prevLon);
    prevLat = lat;
    prevLon = lon;
  }
  return out;
}
