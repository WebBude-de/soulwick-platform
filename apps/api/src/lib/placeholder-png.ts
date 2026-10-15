import { crc32, deflateSync } from "node:zlib";

/**
 * Small real PNG files without an image library, for the dev seed (bug report screenshots in the
 * admin panel) and the tests. Not used by any route.
 */

function chunk(type: string, data: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const body = Buffer.from(data);
  const out = Buffer.alloc(12 + body.length);
  out.writeUInt32BE(body.length, 0);
  typeBytes.copy(out, 4);
  body.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([typeBytes, body])), 8 + body.length);
  return out;
}

/** RGB colour, each channel 0-255. */
export type Rgb = readonly [number, number, number];

/**
 * An 8-bit RGB PNG of `width` x `height` with a dark diagonal gradient towards `tint`, roughly the
 * colours of the dungeon.
 */
export function placeholderPng(
  width: number,
  height: number,
  tint: Rgb = [217, 138, 58]
): Uint8Array<ArrayBuffer> {
  const [tr, tg, tb] = tint;
  const rowBytes = 1 + width * 3;
  const raw = Buffer.alloc(rowBytes * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * rowBytes] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      const t = (x / Math.max(1, width - 1) + y / Math.max(1, height - 1)) / 2;
      const i = y * rowBytes + 1 + x * 3;
      raw[i] = Math.round(12 + tr * t * 0.6);
      raw[i + 1] = Math.round(10 + tg * t * 0.6);
      raw[i + 2] = Math.round(16 + tb * t * 0.6);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type RGB
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array(0)),
  ]);
  const out = new Uint8Array(png.length);
  out.set(png);
  return out;
}
