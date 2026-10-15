import {
  RELAY_FRAME_HEADER_BYTES,
  RELAY_FRAME_OFFSET,
  type RelayClientMessage,
  RelayClientMessage as RelayClientMessageSchema,
  type RelayServerMessage,
} from "@soulwick/contracts";

export type ParseResult =
  | { ok: true; message: RelayClientMessage }
  | { ok: false; request?: string; reason: string };

/** Parses one JSON text frame into a control message (schemas from @soulwick/contracts). */
export function parseClientMessage(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: "not valid JSON" };
  }
  const type =
    raw &&
    typeof raw === "object" &&
    "type" in raw &&
    typeof raw.type === "string"
      ? raw.type
      : undefined;
  const result = RelayClientMessageSchema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return {
      ok: false,
      request: type,
      reason: `${where}${issue?.message ?? "invalid message"}`,
    };
  }
  return { ok: true, message: result.data };
}

export function encodeServerMessage(message: RelayServerMessage): string {
  return JSON.stringify(message);
}

/** Header fields the relay needs for routing; the payload stays untouched. */
export interface FrameHeader {
  mode: number;
  to: number;
}

export function readFrameHeader(bytes: Uint8Array): FrameHeader | null {
  if (bytes.length < RELAY_FRAME_HEADER_BYTES) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    to: view.getInt32(RELAY_FRAME_OFFSET.to, true),
    mode: view.getUint8(RELAY_FRAME_OFFSET.mode),
  };
}

/** Copy of the frame with `from` set to the sender (whatever the sender wrote is replaced). */
export function stampSender(bytes: Uint8Array, from: number): Uint8Array {
  const out = new Uint8Array(bytes.length);
  out.set(bytes);
  new DataView(out.buffer).setInt32(RELAY_FRAME_OFFSET.from, from, true);
  return out;
}
