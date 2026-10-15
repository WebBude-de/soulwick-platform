/** Window for the bytes-per-second figures. */
const RATE_WINDOW_MS = 10_000;

export type DropReason =
  | "backpressure"
  | "not_in_room"
  | "invalid_target"
  | "unknown_target"
  | "too_large"
  | "invalid"
  | "rate_limited"
  | "sim_loss";

/** Simple in-memory counters for `/health` and `GET /metrics` (no payloads, no player data). */
export class Metrics {
  readonly startedAt: number;
  connectionsTotal = 0;
  connectionsRejected = 0;
  roomsCreated = 0;
  readonly roomsClosed: Record<string, number> = {};
  framesIn = 0;
  framesOut = 0;
  bytesIn = 0;
  bytesOut = 0;
  controlIn = 0;
  readonly framesDropped: Record<string, number> = {};
  readonly errors: Record<string, number> = {};
  slowConsumersClosed = 0;
  /** Largest binary frame received so far (bytes); compare with MAX_FRAME_BYTES. */
  maxFrameIn = 0;
  private readonly samples: { at: number; in: number; out: number }[] = [];

  constructor(now: number) {
    this.startedAt = now;
    this.samples.push({ at: now, in: 0, out: 0 });
  }

  drop(reason: DropReason, count = 1) {
    this.framesDropped[reason] = (this.framesDropped[reason] ?? 0) + count;
  }

  error(code: string) {
    this.errors[code] = (this.errors[code] ?? 0) + 1;
  }

  roomClosed(reason: string) {
    this.roomsClosed[reason] = (this.roomsClosed[reason] ?? 0) + 1;
  }

  /** Called about once per second; keeps the samples of the last RATE_WINDOW_MS. */
  sample(now: number) {
    this.samples.push({ at: now, in: this.bytesIn, out: this.bytesOut });
    while (
      this.samples.length > 2 &&
      (this.samples[0]?.at ?? now) < now - RATE_WINDOW_MS
    ) {
      this.samples.shift();
    }
  }

  rates(): { bytesInPerSecond: number; bytesOutPerSecond: number } {
    const first = this.samples[0];
    const last = this.samples.at(-1);
    if (!(first && last) || last.at <= first.at) {
      return { bytesInPerSecond: 0, bytesOutPerSecond: 0 };
    }
    const seconds = (last.at - first.at) / 1000;
    return {
      bytesInPerSecond: Math.round((last.in - first.in) / seconds),
      bytesOutPerSecond: Math.round((last.out - first.out) / seconds),
    };
  }
}
