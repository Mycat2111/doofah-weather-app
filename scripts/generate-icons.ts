/**
 * Renders the app icons from scripts/icons/doofah-icon.svg.
 * Run with: npm run icons
 *
 * Uses sharp, which Next.js already installs for image optimisation.
 */
import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";

const SOURCE = "scripts/icons/doofah-icon.svg";

/**
 * - "any": rounded corners, for browsers, desktop installs and the favicon.
 * - "maskable": full bleed with the artwork inside the 80% safe zone, so
 *   Android can crop it to a circle, squircle or teardrop.
 * - "apple": full bleed and opaque; iOS rounds the corners itself.
 */
type Variant = "any" | "maskable" | "apple";

function svgFor(source: string, variant: Variant): string {
  const radius = variant === "any" ? 112 : 0;
  const scale = variant === "maskable" ? 0.84 : variant === "apple" ? 0.94 : 1;
  return source
    .replace(
      '<rect id="frame" width="512" height="512" rx="0"/>',
      `<rect id="frame" width="512" height="512" rx="${radius}"/>`,
    )
    .replace(
      '<g id="art" transform="',
      `<g id="art" transform="translate(256 256) scale(${scale}) translate(-256 -256) `,
    );
}

// Rendered at 1024 px (density 144) and scaled down, for clean edges at every size.
const png = (svg: string, size: number) =>
  sharp(Buffer.from(svg), { density: 144 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer();

/** An .ico that stores PNG images, which every current browser reads. */
function ico(images: { size: number; data: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size, 0);
    entry.writeUInt8(size, 1);
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

async function main() {
  const source = await readFile(SOURCE, "utf8");
  const any = svgFor(source, "any");
  const maskable = svgFor(source, "maskable");
  const apple = svgFor(source, "apple");

  const outputs: [string, Promise<Buffer | string>][] = [
    ["public/icons/icon-192.png", png(any, 192)],
    ["public/icons/icon-512.png", png(any, 512)],
    ["public/icons/icon-maskable-192.png", png(maskable, 192)],
    ["public/icons/icon-maskable-512.png", png(maskable, 512)],
    ["src/app/apple-icon.png", png(apple, 180)],
    ["src/app/icon.svg", Promise.resolve(any)],
    [
      "src/app/favicon.ico",
      Promise.all([16, 32, 48].map(async (size) => ({ size, data: await png(any, size) }))).then(ico),
    ],
  ];
  for (const [path, content] of outputs) {
    await writeFile(path, await content);
    console.log(`✓ ${path}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
