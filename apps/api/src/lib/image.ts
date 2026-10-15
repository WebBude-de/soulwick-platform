import type { BugReportImageMime } from "@soulwick/contracts";
import { ApiError } from "./errors.ts";

/** Standard base64 with padding, as Godot's `Marshalls.raw_to_base64` writes it. */
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(bytes: Uint8Array, prefix: number[], offset = 0): boolean {
  return prefix.every((b, i) => bytes[offset + i] === b);
}

const ascii = (text: string) => [...text].map((ch) => ch.charCodeAt(0));

/**
 * Image type from the magic bytes (never from a client-sent MIME type): PNG signature, JPEG SOI
 * marker followed by another marker, or a RIFF container of type WEBP. Null for anything else.
 */
export function sniffImageMime(bytes: Uint8Array): BugReportImageMime | null {
  if (bytes.length >= 8 && startsWith(bytes, PNG_SIGNATURE)) {
    return "image/png";
  }
  if (bytes.length >= 3 && startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    startsWith(bytes, ascii("RIFF")) &&
    startsWith(bytes, ascii("WEBP"), 8)
  ) {
    return "image/webp";
  }
  return null;
}

const invalidImage = (message: string) =>
  new ApiError(400, "invalid_image", message);

/**
 * Decodes a base64 screenshot and checks size and type. 413 `payload_too_large` above `maxBytes`
 * (checked on the base64 length first, so oversized strings are never decoded), 400
 * `invalid_image` for broken base64 or a type other than WebP, JPEG or PNG.
 */
export function decodeImage(
  base64: string,
  maxBytes: number
): { bytes: Uint8Array<ArrayBuffer>; mime: BugReportImageMime } {
  if (base64.length > Math.ceil(maxBytes / 3) * 4) {
    throw new ApiError(
      413,
      "payload_too_large",
      `The image must be at most ${maxBytes} bytes`
    );
  }
  if (base64.length % 4 !== 0 || !BASE64.test(base64)) {
    throw invalidImage("The image must be standard base64 with padding");
  }
  const decoded = Buffer.from(base64, "base64");
  // A copy on its own ArrayBuffer (Prisma `Bytes` wants Uint8Array<ArrayBuffer>).
  const bytes = new Uint8Array(decoded.length);
  bytes.set(decoded);
  if (bytes.length > maxBytes) {
    throw new ApiError(
      413,
      "payload_too_large",
      `The image must be at most ${maxBytes} bytes`
    );
  }
  const mime = sniffImageMime(bytes);
  if (!mime) {
    throw invalidImage("The image must be a WebP, JPEG or PNG file");
  }
  return { bytes, mime };
}
