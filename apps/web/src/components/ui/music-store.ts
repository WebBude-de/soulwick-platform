"use client";

/**
 * One shared <audio> element for every music control on the page. Off by default; on/off and the
 * volume are remembered in localStorage (wrapped in try/catch for private mode). The track fades
 * in and out so it never starts or stops abruptly.
 */
const STORAGE_KEY = "soulwick.music";
const VOLUME_STORAGE_KEY = "soulwick.music.volume";
/** Volume before the visitor picks one (0–1). */
export const DEFAULT_VOLUME = 0.35;
/** Fade-in when the music starts (was 1200 ms, halved for a snappier start). */
const FADE_IN_MS = 600;
/** Fade-out when the music stops (was 1200 ms, halved). */
const FADE_OUT_MS = 600;
const FADE_STEP_MS = 50;

export type MusicState = "off" | "loading" | "on" | "unsupported";

type Listener = () => void;

const listeners = new Set<Listener>();
let state: MusicState = "off";
let volume: number | null = null;
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

function clampVolume(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_VOLUME;
  }
  return Math.min(1, Math.max(0, value));
}

function readVolume(): number {
  try {
    const raw = window.localStorage.getItem(VOLUME_STORAGE_KEY);
    return raw === null ? DEFAULT_VOLUME : clampVolume(Number(raw));
  } catch {
    return DEFAULT_VOLUME;
  }
}

/** Current volume (0–1); read from storage on first use in the browser. */
export function getVolume(): number {
  if (volume === null) {
    volume = typeof window === "undefined" ? DEFAULT_VOLUME : readVolume();
  }
  return volume;
}

export function getServerVolume(): number {
  return DEFAULT_VOLUME;
}

export function setVolume(next: number): void {
  const value = clampVolume(next);
  if (value === volume) {
    return;
  }
  volume = value;
  try {
    window.localStorage.setItem(VOLUME_STORAGE_KEY, String(value));
  } catch {
    // Storage unavailable: the slider still works for this page view.
  }
  // While playing the change is heard at once; a running fade-in reads the new target on its
  // next step, a fade-out ignores it.
  if (audio && state === "on" && fadeTimer === null) {
    audio.volume = value;
  }
  emit();
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

function fadeTo(target: () => number, durationMs: number, onDone?: () => void) {
  const element = audio;
  if (!element) {
    return;
  }
  clearFade();
  const start = element.volume;
  const startedAt = performance.now();
  fadeTimer = window.setInterval(() => {
    const t = Math.min(1, (performance.now() - startedAt) / durationMs);
    element.volume = clampVolume(start + (target() - start) * t);
    if (t >= 1) {
      clearFade();
      onDone?.();
    }
  }, FADE_STEP_MS);
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
    fadeTo(getVolume, FADE_IN_MS);
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
  fadeTo(
    () => 0,
    FADE_OUT_MS,
    () => {
      element.pause();
    }
  );
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
