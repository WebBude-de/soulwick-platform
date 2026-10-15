"use client";

/** Shared guards and timing helpers for the easter eggs (client only). */

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Desktop with a mouse and enough room: the only place the roaming sprites appear. */
export function isWideFinePointer(): boolean {
  return window.matchMedia("(pointer: fine) and (min-width: 1024px)").matches;
}

export function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export function pick<T>(items: readonly T[]): T | undefined {
  return items[Math.floor(Math.random() * items.length)];
}

/** Resolves after `ms`, or rejects early when `signal` aborts. */
export function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true }
    );
  });
}

/** Waits for a Web Animation; cancelling it (abort) rejects. */
export async function play(
  animation: Animation,
  signal: AbortSignal
): Promise<void> {
  const onAbort = () => animation.cancel();
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    await animation.finished;
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}
