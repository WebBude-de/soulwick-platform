/**
 * Takes a fresh picture of the village from the game and saves it as
 * `public/brand/village_ingame.webp` (lossless, 1280×720), so "Your village" on the landing page
 * always shows the village as it looks in the game today.
 *
 *   bun apps/web/scripts/sync-village.ts
 *
 * Starts Godot quietly (`SOULWICK_QUIET=1`, `--audio-driver Dummy`, AGENTS.md §7) with
 * `scripts/capture-village.gd`, which only reads the game and uses a test save. Game folder:
 * `../soulwick` next to this repository (override with SOULWICK_DIR); Godot: GODOT (default
 * `godot` on PATH, e.g. GODOT="C:/Tools/Godot/Godot_v4.7.2-stable_win64.exe"). The camera spot
 * lives in the .gd file. Afterwards look at the picture before committing it.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = fileURLToPath(new URL(".", import.meta.url));
const webRoot = path.resolve(here, "..");
const gameDir = path.resolve(
  process.env.SOULWICK_DIR ?? path.join(webRoot, "..", "..", "..", "soulwick")
);
const godot = process.env.GODOT ?? "godot";
const capture = path.join(here, "capture-village.gd");
const dest = path.join(webRoot, "public", "brand", "village_ingame.webp");
const MAX_BYTES = 300 * 1024;

if (!existsSync(path.join(gameDir, "project.godot"))) {
  throw new Error(`No Godot project at ${gameDir} (set SOULWICK_DIR).`);
}

const out = await mkdtemp(path.join(tmpdir(), "soulwick-village-"));
try {
  const run = spawnSync(
    godot,
    [
      "--audio-driver",
      "Dummy",
      "--path",
      gameDir,
      "-s",
      capture,
      "--",
      out.replaceAll("\\", "/"),
    ],
    {
      env: { ...process.env, SOULWICK_QUIET: "1" },
      stdio: "inherit",
      timeout: 180_000,
    }
  );
  const shot = path.join(out, "village.png");
  if (run.status !== 0 || !existsSync(shot)) {
    throw new Error(`Godot did not write ${shot} (exit ${run.status}).`);
  }
  await sharp(shot).webp({ lossless: true, effort: 6 }).toFile(dest);
  const size = (await stat(dest)).size;
  if (size > MAX_BYTES) {
    throw new Error(`${dest} is ${Math.round(size / 1024)} KB, limit 300 KB.`);
  }
  console.log(`village_ingame.webp: ${Math.round(size / 1024)} KB`);
} finally {
  await rm(out, { recursive: true, force: true });
}
