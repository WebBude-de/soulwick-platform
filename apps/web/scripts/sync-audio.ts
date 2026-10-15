/**
 * Converts the game's soundtrack WAVs to web formats with ffmpeg (must be on PATH):
 * `public/audio/<name>.ogg` (libvorbis q4) and `public/audio/<name>.m4a` (AAC 128k).
 *
 *   bun apps/web/scripts/sync-audio.ts
 *
 * Source: `../soulwick/audio/music` next to this repository (override with SOULWICK_AUDIO_DIR).
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const webRoot = path.resolve(here, "..");
const audioDir = path.resolve(
  process.env.SOULWICK_AUDIO_DIR ??
    path.join(webRoot, "..", "..", "..", "soulwick", "audio", "music")
);
const outDir = path.join(webRoot, "public", "audio");

/** Tracks used by the website: landing page (village) and an optional second track. */
const TRACKS = ["village", "dungeon_crypt"];

function ffmpeg(args: string[]) {
  const result = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-y", ...args],
    { stdio: "inherit" }
  );
  if (result.status !== 0) {
    throw new Error(`ffmpeg exited with ${result.status}: ${args.join(" ")}`);
  }
}

async function convert(name: string): Promise<string> {
  const src = path.join(audioDir, `${name}.wav`);
  if (!existsSync(src)) {
    return `skip ${name}: ${src} not found`;
  }
  const ogg = path.join(outDir, `${name}.ogg`);
  const m4a = path.join(outDir, `${name}.m4a`);
  // Vorbis keeps sample-accurate loops; AAC gets faststart so playback begins early.
  ffmpeg(["-i", src, "-vn", "-c:a", "libvorbis", "-q:a", "4", ogg]);
  ffmpeg([
    "-i",
    src,
    "-vn",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    m4a,
  ]);
  const [o, m, w] = await Promise.all([stat(ogg), stat(m4a), stat(src)]);
  return `${name}: wav ${(w.size / 1024 / 1024).toFixed(2)} MB → ogg ${(o.size / 1024).toFixed(0)} KB, m4a ${(m.size / 1024).toFixed(0)} KB`;
}

await mkdir(outDir, { recursive: true });
const lines = await Promise.all(TRACKS.map((name) => convert(name)));
for (const line of lines) {
  console.log(line);
}
