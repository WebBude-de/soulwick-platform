/**
 * Copies the game's pixel art into `public/sprites/**` as lossless WebP and writes a typed
 * manifest (`src/lib/sprite-manifest.ts`) so components never hard-code frame counts.
 *
 *   bun apps/web/scripts/sync-sprites.ts            # incremental
 *   bun apps/web/scripts/sync-sprites.ts --force    # re-encode everything
 *
 * Source: `../soulwick/art` next to this repository (override with SOULWICK_ART_DIR).
 * Frame data comes from `art/index.json` and the `*.json` files next to the sprites; files
 * without metadata fall back to the `_<n>f` suffix convention of the HANDOUT. Website sprites in
 * `public/brand/sprites/` take precedence over the game copies (same ids) and web-only sprites
 * (chips, divider, tiles, cursor) are added with inferred frames. `art/fonts` and the large store
 * graphics in `art/store` (capsules, icons, feature graphics) are never copied.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = fileURLToPath(new URL(".", import.meta.url));
const webRoot = path.resolve(here, "..");
const artDir = path.resolve(
  process.env.SOULWICK_ART_DIR ??
    path.join(webRoot, "..", "..", "..", "soulwick", "art")
);
const outDir = path.join(webRoot, "public", "sprites");
const brandSpritesDir = path.join(webRoot, "public", "brand", "sprites");
const manifestPath = path.join(webRoot, "src", "lib", "sprite-manifest.ts");
const force = process.argv.includes("--force");

/** Folders under `art/` that are not sprites: the pixel font and the store graphics. */
const SKIPPED_DIRS = new Set(["fonts", "store"]);
const PNG = /\.png$/i;
const JSON_EXT = /\.json$/;
const ART_PREFIX = /^art\//;
const WEBP_OR_PNG = /\.(webp|png)$/i;
const FRAME_SUFFIX = /^.*_(\d+)f$/;
const NON_LOOPING =
  /(death|attack|open|revive|fall|dash|dying|break|breach|fuse)/;

interface Meta {
  fps: number;
  frames: number;
  height: number;
  loop: boolean;
  tileSize?: [number, number];
  tiles?: Record<string, { x: number; y: number }>;
  width: number;
}

interface Entry extends Meta {
  bytes: number;
  id: string;
  rel: string;
  src: string;
}

interface IndexItem {
  file: string;
  fps?: number;
  frames?: number;
  h?: number;
  kind: string;
  loop?: boolean;
  tileH?: number;
  tiles?: Record<string, { x: number; y: number }>;
  tileW?: number;
  w?: number;
}

interface IndexFile {
  groups: { dir: string; items: IndexItem[] }[];
}

type JsonItem = Record<string, unknown>;

if (!existsSync(artDir)) {
  console.error(`Art folder not found: ${artDir}`);
  process.exit(1);
}

const toPosix = (p: string) => p.split(path.sep).join("/");

async function walk(
  dir: string,
  matches: (name: string) => boolean,
  acc: string[] = []
): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) {
          await walk(full, matches, acc);
        }
      } else if (matches(entry.name)) {
        acc.push(full);
      }
    })
  );
  return acc;
}

/** Frame metadata keyed by art-relative file path (`characters/player/player_idle_4f.png`). */
async function collectMetadata(): Promise<Map<string, Partial<Meta>>> {
  const byFile = new Map<string, Partial<Meta>>();
  const put = (file: string, meta: Partial<Meta>) => {
    const key = toPosix(file).replace(ART_PREFIX, "");
    byFile.set(key, { ...byFile.get(key), ...meta });
  };

  // 1) art/index.json: authoritative for everything it lists.
  const index = JSON.parse(
    await readFile(path.join(artDir, "index.json"), "utf8")
  ) as IndexFile;
  for (const group of index.groups) {
    for (const item of group.items) {
      if (item.kind === "tileset") {
        put(item.file, {
          tileSize: [item.tileW ?? 32, item.tileH ?? 32],
          tiles: item.tiles,
          frames: 1,
          fps: 0,
          loop: false,
        });
      } else {
        put(item.file, {
          width: item.w,
          height: item.h,
          frames: item.frames ?? 1,
          fps: item.fps ?? 0,
          loop: item.loop ?? false,
        });
      }
    }
  }

  // 2) Per-folder JSON files (items[] / animations[] / extras[]) fill the gaps.
  const jsonFiles = await walk(
    artDir,
    (name) => name.endsWith(".json") && name !== "index.json"
  );
  const parsed = await Promise.all(
    jsonFiles.map(async (jsonFile) => {
      try {
        return {
          jsonFile,
          data: JSON.parse(await readFile(jsonFile, "utf8")) as JsonItem,
        };
      } catch {
        return null;
      }
    })
  );
  for (const file of parsed) {
    if (!file) {
      continue;
    }
    const { jsonFile, data } = file;
    const dirRel = toPosix(path.relative(artDir, path.dirname(jsonFile)));
    const frameSize = data.frame_size as [number, number] | undefined;
    const lists: JsonItem[] = [
      ...((data.items as JsonItem[] | undefined) ?? []),
      ...((data.animations as JsonItem[] | undefined) ?? []),
      ...((data.extras as JsonItem[] | undefined) ?? []),
    ];
    for (const item of lists) {
      const itemFile = item.file as string | undefined;
      if (!itemFile) {
        continue;
      }
      const size = (item.frame_size ?? item.size ?? frameSize) as
        | [number, number]
        | undefined;
      const rel = dirRel ? `${dirRel}/${itemFile}` : itemFile;
      if (byFile.has(rel)) {
        continue;
      }
      put(rel, {
        width: size?.[0],
        height: size?.[1],
        frames: (item.frames as number | undefined) ?? 1,
        fps: (item.fps as number | undefined) ?? 0,
        loop: (item.loop as boolean | undefined) ?? false,
      });
    }
    const tiles = data.tiles as
      | Record<string, { x: number; y: number }>
      | undefined;
    const tileSize = data.tile_size as [number, number] | undefined;
    if (tiles && tileSize) {
      const pngRel = toPosix(path.relative(artDir, jsonFile)).replace(
        JSON_EXT,
        ".png"
      );
      put(pngRel, { tiles, tileSize, frames: 1, fps: 0, loop: false });
    }
  }
  return byFile;
}

function inferMeta(
  base: string,
  sheetW: number,
  sheetH: number,
  known: Partial<Meta>
): Meta {
  const fromSuffix = Number(base.replace(FRAME_SUFFIX, "$1"));
  const frames = known.frames ?? (Number.isNaN(fromSuffix) ? 1 : fromSuffix);
  return {
    width: known.width ?? Math.round(sheetW / Math.max(1, frames)),
    height: known.height ?? sheetH,
    frames,
    fps: known.fps ?? (frames > 1 ? 6 : 0),
    loop: known.loop ?? (frames > 1 ? !NON_LOOPING.test(base) : false),
    tiles: known.tiles,
    tileSize: known.tileSize,
  };
}

async function convertGameSprite(
  file: string,
  meta: Map<string, Partial<Meta>>
): Promise<{ entry: Entry; written: boolean }> {
  const rel = toPosix(path.relative(artDir, file));
  const relWebp = rel.replace(PNG, ".webp");
  const dest = path.join(outDir, relWebp);
  await mkdir(path.dirname(dest), { recursive: true });

  const srcStat = await stat(file);
  const upToDate =
    !force && existsSync(dest) && (await stat(dest)).mtimeMs >= srcStat.mtimeMs;
  if (!upToDate) {
    await sharp(file).webp({ lossless: true, effort: 5 }).toFile(dest);
  }

  const image = await sharp(file).metadata();
  const base = path.basename(rel, ".png");
  const entry: Entry = {
    id: base,
    rel,
    src: `/sprites/${relWebp}`,
    bytes: (await stat(dest)).size,
    ...inferMeta(
      base,
      image.width ?? 0,
      image.height ?? 0,
      meta.get(rel) ?? {}
    ),
  };
  return { entry, written: !upToDate };
}

async function readBrandSprite(
  file: string,
  byId: Map<string, Entry>
): Promise<Entry> {
  const full = path.join(brandSpritesDir, file);
  const base = file.replace(WEBP_OR_PNG, "");
  const image = await sharp(full).metadata();
  const sheetW = image.width ?? 0;
  const sheetH = image.height ?? 0;
  const existing = byId.get(base);
  const sameSheet =
    existing &&
    existing.width * existing.frames === sheetW &&
    existing.height === sheetH;
  const known: Partial<Meta> = sameSheet
    ? existing
    : {
        frames: existing?.frames,
        fps: existing?.fps,
        loop: existing?.loop,
      };
  return {
    id: base,
    rel: `brand/sprites/${file}`,
    src: `/brand/sprites/${file}`,
    bytes: (await stat(full)).size,
    ...inferMeta(base, sheetW, sheetH, known),
  };
}

function formatEntry(e: Entry): string {
  const extra: string[] = [];
  if (e.tileSize) {
    extra.push(`tileSize: [${e.tileSize[0]}, ${e.tileSize[1]}]`);
  }
  if (e.tiles) {
    const tiles = Object.fromEntries(
      Object.entries(e.tiles).map(([name, tile]) => [
        name,
        { x: tile.x, y: tile.y },
      ])
    );
    extra.push(`tiles: ${JSON.stringify(tiles)}`);
  }
  const tail = extra.length > 0 ? `, ${extra.join(", ")}` : "";
  return `  "${e.id}": { src: "${e.src}", width: ${e.width}, height: ${e.height}, frames: ${e.frames}, fps: ${e.fps}, loop: ${e.loop}${tail} },`;
}

async function main() {
  const started = Date.now();
  const meta = await collectMetadata();
  const files = (await walk(artDir, (name) => PNG.test(name))).sort();
  const results = await Promise.all(
    files.map((file) => convertGameSprite(file, meta))
  );
  const entries = results.map((r) => r.entry);
  const written = results.filter((r) => r.written).length;

  // Ids are the file name without extension; on collision both get their folder as prefix.
  const counts = new Map<string, number>();
  for (const e of entries) {
    counts.set(e.id, (counts.get(e.id) ?? 0) + 1);
  }
  const collisions: string[] = [];
  for (const e of entries) {
    if ((counts.get(e.id) ?? 0) > 1) {
      collisions.push(e.rel);
      e.id = e.rel.replace(PNG, "");
    }
  }

  // Website sprites override or extend the game entries.
  const byId = new Map(entries.map((e) => [e.id, e]));
  if (existsSync(brandSpritesDir)) {
    const brandFiles = (await readdir(brandSpritesDir))
      .filter((f) => WEBP_OR_PNG.test(f))
      .sort();
    const brandEntries = await Promise.all(
      brandFiles.map((file) => readBrandSprite(file, byId))
    );
    for (const entry of brandEntries) {
      const existing = byId.get(entry.id);
      if (existing) {
        Object.assign(existing, entry);
      } else {
        entries.push(entry);
        byId.set(entry.id, entry);
      }
    }
  }
  entries.sort((a, b) => a.id.localeCompare(b.id));

  const manifest = `// Generated by scripts/sync-sprites.ts from ../soulwick/art and public/brand/sprites. Do not edit by hand.
// Re-run: bun apps/web/scripts/sync-sprites.ts

export interface SpriteMeta {
  /** Public URL of the lossless WebP sheet. */
  src: string;
  /** Size of one frame in source pixels. */
  width: number;
  height: number;
  /** Horizontal frame count (1 = static image). */
  frames: number;
  /** Playback speed; 0 for static images. */
  fps: number;
  loop: boolean;
  /** Only for tilesets: tile size and named tile offsets in source pixels. */
  tileSize?: [number, number];
  tiles?: Record<string, { x: number; y: number }>;
}

export const sprites = {
${entries.map(formatEntry).join("\n")}
} as const satisfies Record<string, SpriteMeta>;

export type SpriteId = keyof typeof sprites;

export function getSprite(id: SpriteId): SpriteMeta {
  return sprites[id];
}
`;
  await writeFile(manifestPath, manifest, "utf8");
  // Match the repository's formatter so `biome check` stays green for the generated file.
  // Relative path: the repository path contains spaces, which a shell would split.
  spawnSync(
    "bunx",
    ["biome", "format", "--write", "src/lib/sprite-manifest.ts"],
    {
      cwd: webRoot,
      shell: true,
      stdio: ["ignore", "ignore", "inherit"],
    }
  );

  const totalBytes = entries.reduce((sum, e) => sum + e.bytes, 0);
  console.log(
    `sprites: ${entries.length} entries (${files.length} game files, ${written} written), ${(totalBytes / 1024).toFixed(0)} KB total, ${Date.now() - started} ms`
  );
  if (collisions.length > 0) {
    console.log(
      `ids prefixed with their folder (name collisions): ${collisions.join(", ")}`
    );
  }
  console.log(`manifest: ${path.relative(webRoot, manifestPath)}`);
}

await main();
