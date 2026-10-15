"use client";

/**
 * One shared <audio> element for every MusicToggle on the page. Off by default; the choice is
 * remembered in localStorage (wrapped in try/catch for private mode). Volume 0.35 with a short
 * fade so the track never starts abruptly.
 */
const STORAGE_KEY = "soulwick.music";
const TARGET_VOLUME = 0.35;
const FADE_MS = 1200;

export type MusicState = "off" | "loading" | "on" | "unsupported";

type Listener = () => void;

const listeners = new Set<Listener>();
let state: MusicState = "off";
let audio: HTMLAudioElement | null = null;
let fadeTimer: number | null = null;

export const SOURCES = [
  { src: "/audio/village.ogg", type: 'audio/ogg; codecs="vorbis"' },
  { src: "/audio/village.m4a", type: "audio/mp4" },
];

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

function setState(next: MusicState) {
  if (state !== next) {
    state = next;
    emit();
  }
}

function remember(on: boolean) {
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
  } catch {
    // Storage unavailable (private mode, quota): the toggle still works for this page view.
  }
}

export function readPreference(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function ensureAudio(): HTMLAudioElement | null {
  if (audio) {
    return audio;
  }
  if (typeof Audio === "undefined") {
    return null;
  }
  const element = new Audio();
  const playable = SOURCES.find((source) => element.canPlayType(source.type));
  if (!playable) {
    setState("unsupported");
    return null;
  }
  element.src = playable.src;
  element.loop = true;
  element.preload = "none";
  element.volume = 0;
  element.addEventListener("error", () => {
    setState("unsupported");
  });
  audio = element;
  return element;
}

function clearFade() {
  if (fadeTimer !== null) {
    window.clearInterval(fadeTimer);
    fadeTimer = null;
  }
}

function fadeTo(target: number, onDone?: () => void) {
  const element = audio;
  if (!element) {
    return;
  }
  clearFade();
  const start = element.volume;
  const startedAt = performance.now();
  fadeTimer = window.setInterval(() => {
    const t = Math.min(1, (performance.now() - startedAt) / FADE_MS);
    element.volume = start + (target - start) * t;
    if (t >= 1) {
      clearFade();
      onDone?.();
    }
  }, 50);
}

export async function startMusic(): Promise<void> {
  const element = ensureAudio();
  if (!element) {
    return;
  }
  setState("loading");
  try {
    element.volume = 0;
    await element.play();
    setState("on");
    remember(true);
    fadeTo(TARGET_VOLUME);
  } catch {
    // Autoplay blocked or decoding failed: stay off, the next click will try again.
    setState("off");
  }
}

export function stopMusic(): void {
  const element = audio;
  remember(false);
  if (!element) {
    setState("off");
    return;
  }
  fadeTo(0, () => {
    element.pause();
  });
  setState("off");
}

export function toggleMusic(): void {
  if (state === "on" || state === "loading") {
    stopMusic();
  } else if (state !== "unsupported") {
    startMusic().catch(() => setState("off"));
  }
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): MusicState {
  return state;
}

export function getServerSnapshot(): MusicState {
  return "off";
}
