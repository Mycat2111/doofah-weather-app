/**
 * A small BUFR (edition 3 and 4) reader, enough for ECMWF's tropical cyclone
 * tracks: table B elements, table D sequences, fixed and delayed
 * replication, compressed and uncompressed subsets, and the operators that
 * only change widths and scales (2-01, 2-02, 2-05, 2-06, 2-07, 2-08).
 *
 * Anything else (associated fields, bitmaps, new reference values, an
 * element outside bufrTables.ts) stops with a BufrError: a message the
 * reader can't follow is better refused than misread.
 */

import { TABLE_B, TABLE_D } from "./bufrTables";

export class BufrError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BufrError";
  }
}

/** One value of a subset: the table B descriptor (FXXYYY as a number) and its value, null when missing. */
export interface BufrValue {
  code: number;
  value: number | string | null;
}

export interface BufrMessage {
  edition: number;
  centre: number;
  dataCategory: number;
  masterTablesVersion: number;
  /** The message's typical time from section 1, ISO UTC. */
  typicalTime: string;
  compressed: boolean;
  /** The descriptors as written in section 3. */
  descriptors: number[];
  /** Each subset's values, in data order. */
  subsets: BufrValue[][];
}

interface Element {
  width: number;
  scale: number;
  reference: number;
  /** s: text, c: code or flag table, n: a measured number. */
  kind: "s" | "c" | "n";
}

let tableB: Map<number, Element> | null = null;
let tableD: Map<number, number[]> | null = null;

function tables() {
  if (!tableB || !tableD) {
    tableB = new Map();
    for (const line of TABLE_B.trim().split("\n")) {
      const [code, width, scale, reference, kind] = line.split(" ");
      tableB.set(Number(code), {
        width: Number(width),
        scale: Number(scale),
        reference: Number(reference),
        kind: kind as Element["kind"],
      });
    }
    tableD = new Map();
    for (const line of TABLE_D.trim().split("\n")) {
      const [code, ...list] = line.split(" ").map(Number);
      tableD.set(code, list);
    }
  }
  return { b: tableB, d: tableD };
}

const fOf = (code: number) => Math.floor(code / 100000);
const xOf = (code: number) => Math.floor(code / 1000) % 100;
const yOf = (code: number) => code % 1000;
const name = (code: number) => String(code).padStart(6, "0");

/** Reads big-endian bit fields of any width up to 53 bits. */
class Bits {
  private pos: number;
  constructor(
    private readonly bytes: Uint8Array,
    start: number,
    private readonly end: number,
  ) {
    this.pos = start * 8;
  }

  read(width: number): number {
    if (width === 0) return 0;
    if (width > 53) throw new BufrError(`A ${width}-bit number is too wide`);
    if (this.pos + width > this.end * 8) throw new BufrError("The data section ended early");
    let value = 0;
    for (let left = width; left > 0; ) {
      const byte = this.bytes[this.pos >> 3];
      const offset = this.pos & 7;
      const take = Math.min(left, 8 - offset);
      const bits = (byte >> (8 - offset - take)) & ((1 << take) - 1);
      value = value * 2 ** take + bits;
      this.pos += take;
      left -= take;
    }
    return value;
  }

  /** `chars` bytes of text; null when every bit is set (missing). */
  text(chars: number): string | null {
    let missing = true;
    let out = "";
    for (let i = 0; i < chars; i++) {
      const c = this.read(8);
      if (c !== 0xff) missing = false;
      out += c === 0 ? " " : String.fromCharCode(c);
    }
    return missing ? null : out.trim();
  }
}

const allOnes = (width: number) => 2 ** width - 1;

/** The state of the width and scale operators while descriptors are read. */
interface Operators {
  width: number;
  scale: number;
  /** 2-07: scale, width and reference all increased together. */
  increase: number;
  /** 2-08: width of text fields, in bits; 0 for the table's own. */
  textWidth: number;
  /** 2-06: the next element is local, this many bits wide. */
  local: number;
}

/**
 * Decodes values for one subset at a time (uncompressed) or every subset at
 * once (compressed): each read returns one value per subset it covers.
 */
class Reader {
  readonly out: BufrValue[][];
  private readonly ops: Operators = { width: 0, scale: 0, increase: 0, textWidth: 0, local: 0 };

  constructor(
    private readonly bits: Bits,
    private readonly count: number,
    private readonly compressed: boolean,
  ) {
    this.out = Array.from({ length: count }, () => []);
  }

  run(descriptors: number[]) {
    this.walk(descriptors);
  }

  private walk(list: number[]) {
    const { d } = tables();
    for (let i = 0; i < list.length; i++) {
      const code = list[i];
      switch (fOf(code)) {
        case 0:
          this.element(code);
          break;
        case 1: {
          const span = xOf(code);
          let times = yOf(code);
          let next = i + 1;
          if (times === 0) {
            // Delayed: the next element says how many times.
            const factor = list[next];
            if (factor !== 31000 && factor !== 31001 && factor !== 31002) {
              throw new BufrError(`Replication by ${name(factor)} is not supported`);
            }
            const values = this.element(factor);
            const first = values[0];
            if (typeof first !== "number" || values.some((v) => v !== first)) {
              throw new BufrError("Subsets disagree on a replication count");
            }
            times = first;
            next += 1;
          }
          const body = list.slice(next, next + span);
          if (body.length < span) throw new BufrError("A replication runs past the end of its list");
          for (let t = 0; t < times; t++) this.walk(body);
          i = next + span - 1;
          break;
        }
        case 2:
          this.operator(code);
          break;
        case 3: {
          const seq = d.get(code);
          if (!seq) throw new BufrError(`Sequence ${name(code)} is not in DooFah's tables`);
          this.walk(seq);
          break;
        }
      }
    }
  }

  private operator(code: number) {
    const x = xOf(code);
    const y = yOf(code);
    switch (x) {
      case 1:
        this.ops.width = y === 0 ? 0 : y - 128;
        return;
      case 2:
        this.ops.scale = y === 0 ? 0 : y - 128;
        return;
      case 5:
        // Text written right into the data: y characters, not a value of any element.
        this.text(y * 8);
        return;
      case 6:
        this.ops.local = y;
        return;
      case 7:
        this.ops.increase = y;
        return;
      case 8:
        this.ops.textWidth = y * 8;
        return;
      default:
        throw new BufrError(`Operator ${name(code)} is not supported`);
    }
  }

  /** Reads one element; returns its value in each subset covered by this read. */
  private element(code: number): (number | string | null)[] {
    if (this.ops.local) {
      // A local element: skip its bits, whatever it is.
      const width = this.ops.local;
      this.ops.local = 0;
      if (this.compressed) {
        this.bits.read(width);
        const nbinc = this.bits.read(6);
        for (let s = 0; s < this.count && nbinc; s++) this.bits.read(nbinc);
      } else {
        this.bits.read(width);
      }
      return Array(this.compressed ? this.count : 1).fill(null);
    }
    const spec = tables().b.get(code);
    if (!spec) throw new BufrError(`Element ${name(code)} is not in DooFah's tables`);
    let values: (number | string | null)[];
    if (spec.kind === "s") {
      values = this.text(this.ops.textWidth || spec.width);
    } else {
      // Code and flag tables and replication counts keep their widths; the operators only change measured values.
      let { width, scale, reference } = spec;
      if (spec.kind === "n" && xOf(code) !== 31) {
        width += this.ops.width;
        scale += this.ops.scale;
        if (this.ops.increase) {
          scale += this.ops.increase;
          reference *= 10 ** this.ops.increase;
          width += Math.floor((10 * this.ops.increase + 2) / 3);
        }
      }
      values = this.number(width, scale, reference);
    }
    if (this.compressed) {
      values.forEach((v, s) => this.out[s].push({ code, value: v }));
    } else {
      this.out[0].push({ code, value: values[0] });
    }
    return values;
  }

  private number(width: number, scale: number, reference: number): (number | null)[] {
    const value = (raw: number) => {
      const v = (raw + reference) / 10 ** scale;
      // Tidy binary noise from the division (34.199999 → 34.2).
      return scale > 0 ? Number(v.toFixed(scale)) : v;
    };
    if (!this.compressed) {
      const raw = this.bits.read(width);
      return [width > 1 && raw === allOnes(width) ? null : value(raw)];
    }
    const base = this.bits.read(width);
    const nbinc = this.bits.read(6);
    if (nbinc === 0) {
      const v = width > 1 && base === allOnes(width) ? null : value(base);
      return Array(this.count).fill(v);
    }
    const out: (number | null)[] = [];
    for (let s = 0; s < this.count; s++) {
      const inc = this.bits.read(nbinc);
      out.push(inc === allOnes(nbinc) ? null : value(base + inc));
    }
    return out;
  }

  private text(width: number): (string | null)[] {
    const chars = width / 8;
    if (!this.compressed) return [this.bits.text(chars)];
    const base = this.bits.text(chars);
    const nbinc = this.bits.read(6);
    if (nbinc === 0) return Array(this.count).fill(base);
    return Array.from({ length: this.count }, () => this.bits.text(nbinc));
  }
}

const u16 = (b: Uint8Array, at: number) => (b[at] << 8) | b[at + 1];
const u24 = (b: Uint8Array, at: number) => (b[at] << 16) | (b[at + 1] << 8) | b[at + 2];

function isoTime(y: number, mo: number, d: number, h: number, mi: number, s = 0) {
  const date = new Date(Date.UTC(2000, mo - 1, d, h, mi, s));
  date.setUTCFullYear(y);
  return date.toISOString();
}

/** Decodes one message starting at `start` ("BUFR"); returns it and where the next one may start. */
function decodeMessage(bytes: Uint8Array, start: number): { message: BufrMessage; end: number } {
  const total = u24(bytes, start + 4);
  const edition = bytes[start + 7];
  const end = start + total;
  if (end > bytes.length) throw new BufrError("The message is cut short");
  if (String.fromCharCode(...bytes.subarray(end - 4, end)) !== "7777") throw new BufrError("No end marker");
  if (edition !== 3 && edition !== 4) throw new BufrError(`BUFR edition ${edition} is not supported`);

  // Section 0 is 8 bytes in both editions.
  let at = start + 8;
  const s1 = at;
  const s1Length = u24(bytes, s1);
  let centre: number, dataCategory: number, masterTablesVersion: number, typicalTime: string, hasSection2: boolean;
  if (edition === 4) {
    centre = u16(bytes, s1 + 4);
    hasSection2 = (bytes[s1 + 9] & 0x80) !== 0;
    dataCategory = bytes[s1 + 10];
    masterTablesVersion = bytes[s1 + 13];
    // Some producers (older ECMWF tracks among them) write only the year of the century here.
    const year = u16(bytes, s1 + 15);
    typicalTime = isoTime(
      year < 100 ? 2000 + year : year,
      bytes[s1 + 17],
      bytes[s1 + 18],
      bytes[s1 + 19],
      bytes[s1 + 20],
      bytes[s1 + 21],
    );
  } else {
    centre = bytes[s1 + 5];
    hasSection2 = (bytes[s1 + 7] & 0x80) !== 0;
    dataCategory = bytes[s1 + 8];
    masterTablesVersion = bytes[s1 + 10];
    const yy = bytes[s1 + 12];
    typicalTime = isoTime(
      yy > 50 ? 1900 + yy : 2000 + yy,
      bytes[s1 + 13],
      bytes[s1 + 14],
      bytes[s1 + 15],
      bytes[s1 + 16],
    );
  }
  at += s1Length;
  if (hasSection2) at += u24(bytes, at);

  // Section 3: subsets and descriptors.
  const s3Length = u24(bytes, at);
  const subsetCount = u16(bytes, at + 4);
  const compressed = (bytes[at + 6] & 0x40) !== 0;
  const descriptors: number[] = [];
  for (let p = at + 7; p + 1 < at + s3Length; p += 2) {
    const raw = u16(bytes, p);
    const f = raw >> 14;
    const x = (raw >> 8) & 0x3f;
    const y = raw & 0xff;
    descriptors.push(f * 100000 + x * 1000 + y);
  }
  at += s3Length;

  // Section 4: the data, after its 4-byte header.
  const s4Length = u24(bytes, at);
  const bits = new Bits(bytes, at + 4, at + s4Length);
  let subsets: BufrValue[][];
  if (compressed) {
    const reader = new Reader(bits, subsetCount, true);
    reader.run(descriptors);
    subsets = reader.out;
  } else {
    subsets = [];
    for (let s = 0; s < subsetCount; s++) {
      const reader = new Reader(bits, 1, false);
      reader.run(descriptors);
      subsets.push(reader.out[0]);
    }
  }
  return {
    message: { edition, centre, dataCategory, masterTablesVersion, typicalTime, compressed, descriptors, subsets },
    end,
  };
}

/** Every BUFR message in a file, in order. Bytes between messages (headers some feeds add) are skipped. */
export function decodeBufr(bytes: Uint8Array): BufrMessage[] {
  const messages: BufrMessage[] = [];
  let at = 0;
  while (at + 8 <= bytes.length) {
    if (bytes[at] === 0x42 && bytes[at + 1] === 0x55 && bytes[at + 2] === 0x46 && bytes[at + 3] === 0x52) {
      const { message, end } = decodeMessage(bytes, at);
      messages.push(message);
      at = end;
    } else {
      at += 1;
    }
  }
  return messages;
}
