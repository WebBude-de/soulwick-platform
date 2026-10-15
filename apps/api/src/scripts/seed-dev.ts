/**
 * Dev seed: an admin and a moderator, ten test players (each with one `device` identity,
 * P-014; player 1 additionally with a fake `steam` identity), one guild with progress, twenty
 * runs across the current and the previous season (one flagged) plus fourteen runs spread over
 * the last two weeks (admin statistics, P-023), one temporary ban, one moderation note, four
 * entries in the deletion log (P-026, no personal data) and the matching audit entries, so the
 * website leaderboards and every admin page show data locally.
 *
 * Idempotent: every record has a fixed key (email, device id, steam id, guild tag, run seed, ban
 * reason, note text, deletion log id);
 * re-running only adds what is missing and never overwrites changes made through the admin panel
 * (existing admin accounts keep their password, e.g. one changed under "Mein Konto").
 * Refuses to run with NODE_ENV=production.
 *
 * DEFAULT_ADMIN_PASSWORD is the password of the two seeded accounts when they are created (default
 * soulwick-admin-local). The same variable feeds the base seed (seed.ts, DEFAULT_ADMIN_EMAIL);
 * locally both use admin@soulwick.local, so they create the same account and neither resets it.
 *
 *   bun run db:seed:dev                   (repo root; DATABASE_URL from the root .env.local)
 *   DEFAULT_ADMIN_PASSWORD=<min. 12 chars> bun run db:seed:dev   (default: soulwick-admin-local)
 *   In the Docker image (development environment only):
 *   NODE_ENV=development bun apps/api/src/scripts/seed-dev.ts
 */
import { AdminPassword, type RunMode } from "@soulwick/contracts";
import {
  type AccountDeletionChannel,
  createPrisma,
  type Player,
  type Tx,
  type User,
} from "@soulwick/db";
import { createAdminAccount } from "../services/admin-users.ts";
import { writeAudit } from "../services/audit.ts";

if (process.env.NODE_ENV === "production") {
  console.error(
    "The dev seed must never run in production (NODE_ENV=production)."
  );
  process.exit(1);
}

const password = AdminPassword.safeParse(
  process.env.DEFAULT_ADMIN_PASSWORD ?? "soulwick-admin-local"
);
if (!password.success) {
  console.error("DEFAULT_ADMIN_PASSWORD must have 12 to 256 characters.");
  process.exit(1);
}
const PASSWORD = password.data;
const PASSWORD_FROM_ENV = process.env.DEFAULT_ADMIN_PASSWORD !== undefined;

const ADMIN_EMAIL = "admin@soulwick.local";
const MODERATOR_EMAIL = "moderator@soulwick.local";

const DAY_MS = 86_400_000;
const now = new Date();
const daysAgo = (days: number) => new Date(now.getTime() - days * DAY_MS);

/** Device ids are valid for `POST /auth/dev` (min. 16 characters), so you can log in as a seeded player. */
const deviceIdOf = (n: number) => `dev-device-${String(n).padStart(8, "0")}`;

/**
 * Obviously fake Steam id for player 1: below 76561197960265728, the first SteamID64 of an
 * individual account, so it can never belong to a real person. Shows a second identity in
 * GET /me/identities and the Steam id in the admin panel.
 */
const FAKE_STEAM_ID = "76561190000000001";
const STEAM_PLAYER = 1;

/**
 * Deletion log rows for the admin page "Löschprotokoll" (P-026): fixed ids, no player hash (the
 * accounts never existed). Day offsets relative to now.
 */
const DELETIONS: {
  id: string;
  channel: AccountDeletionChannel;
  daysAgo: number;
  wasBanned: boolean;
}[] = [
  {
    id: "00000000-0000-4000-8000-00000000d001",
    channel: "web_code",
    daysAgo: 1,
    wasBanned: false,
  },
  {
    id: "00000000-0000-4000-8000-00000000d002",
    channel: "in_game",
    daysAgo: 3,
    wasBanned: false,
  },
  {
    id: "00000000-0000-4000-8000-00000000d003",
    channel: "web_code",
    daysAgo: 9,
    wasBanned: true,
  },
  {
    id: "00000000-0000-4000-8000-00000000d004",
    channel: "admin",
    daysAgo: 12,
    wasBanned: true,
  },
];

interface PlayerSpec {
  createdDaysAgo: number;
  n: number;
  name: string;
  seenDaysAgo: number;
}

/** Players 1-4 form the guild, 7 is banned for a week. */
const PLAYERS: PlayerSpec[] = [
  { n: 1, name: "Lumen", createdDaysAgo: 58, seenDaysAgo: 0 },
  { n: 2, name: "Aschkralle", createdDaysAgo: 55, seenDaysAgo: 1 },
  { n: 3, name: "Wachsherz", createdDaysAgo: 52, seenDaysAgo: 2 },
  { n: 4, name: "Nebelwicht", createdDaysAgo: 40, seenDaysAgo: 3 },
  { n: 5, name: "Glutfunke", createdDaysAgo: 45, seenDaysAgo: 0 },
  { n: 6, name: "Dochtwart", createdDaysAgo: 30, seenDaysAgo: 5 },
  { n: 7, name: "Sternasche", createdDaysAgo: 25, seenDaysAgo: 1 },
  { n: 8, name: "Kerzenschein", createdDaysAgo: 9, seenDaysAgo: 8 },
  // Recent sign-ups for the "new players" figures of the admin statistics.
  { n: 9, name: "Funkenflug", createdDaysAgo: 3, seenDaysAgo: 0 },
  { n: 10, name: "Rauchquarz", createdDaysAgo: 5, seenDaysAgo: 2 },
];

const GUILD = {
  name: "Dochtwächter",
  tag: "DOCHT",
  inviteCode: "DOCHT2345",
  createdDaysAgo: 50,
  members: [
    { n: 1, role: "founder" },
    { n: 2, role: "officer" },
    { n: 3, role: "member" },
    { n: 4, role: "member" },
  ] as const,
  progress: {
    treasury: 1250,
    // Forge upgrade ids are defined by the game (D-087); these are placeholders for the admin view.
    forgeLevels: { forge_damage: 2, forge_health: 1 },
    version: 3,
  },
};

const BANNED_PLAYER = 7;
const BAN_REASON = "Testsperre aus dem Dev-Seed: unsportliches Verhalten";
const BAN_DAYS = 7;

/** Moderation note on the banned player (P-023), written by the moderator. */
const NOTE_TEXT =
  "Dev-Seed: mehrfach wegen unsportlichen Verhaltens gemeldet, vor der Sperre verwarnt.";

interface RunSpec {
  /** Position inside the season, 0 = start of month, 1 = now (current) or end of month (previous). */
  at: number;
  flagReason?: string;
  key: string;
  mode: RunMode;
  /** 0 = current season (UTC month), 1 = previous season. */
  monthsBack: 0 | 1;
  /** Player numbers; the first one is the reporting host. */
  players: number[];
  room: number;
  seconds: number;
}

/**
 * Twenty runs: solo, quick and guild, spread over two seasons. Durations stay above
 * MIN_SECONDS_PER_ROOM (8 s) except the deliberately flagged one. Runs 08 and 16 include the
 * banned player and therefore vanish from the boards while the ban is active; 12 and 13 tie.
 */
const RUNS: RunSpec[] = [
  {
    key: "01",
    mode: "solo",
    players: [1],
    room: 18,
    seconds: 1260,
    monthsBack: 1,
    at: 0.1,
  },
  {
    key: "02",
    mode: "solo",
    players: [2],
    room: 22,
    seconds: 1500,
    monthsBack: 1,
    at: 0.2,
  },
  {
    key: "03",
    mode: "solo",
    players: [5],
    room: 25,
    seconds: 1680,
    monthsBack: 1,
    at: 0.3,
  },
  {
    key: "04",
    mode: "quick",
    players: [5, 6],
    room: 27,
    seconds: 1800,
    monthsBack: 1,
    at: 0.4,
  },
  {
    key: "05",
    mode: "quick",
    players: [1, 6, 8],
    room: 24,
    seconds: 1620,
    monthsBack: 1,
    at: 0.5,
  },
  {
    key: "06",
    mode: "guild",
    players: [1, 2, 3],
    room: 30,
    seconds: 2100,
    monthsBack: 1,
    at: 0.6,
  },
  {
    key: "07",
    mode: "guild",
    players: [1, 2, 3, 4],
    room: 33,
    seconds: 2280,
    monthsBack: 1,
    at: 0.75,
  },
  {
    key: "08",
    mode: "solo",
    players: [7],
    room: 35,
    seconds: 2200,
    monthsBack: 1,
    at: 0.85,
  },
  {
    key: "09",
    mode: "solo",
    players: [8],
    room: 12,
    seconds: 900,
    monthsBack: 1,
    at: 0.95,
  },
  {
    key: "10",
    mode: "solo",
    players: [1],
    room: 21,
    seconds: 1400,
    monthsBack: 0,
    at: 0.1,
  },
  {
    key: "11",
    mode: "solo",
    players: [3],
    room: 19,
    seconds: 1330,
    monthsBack: 0,
    at: 0.2,
  },
  {
    key: "12",
    mode: "solo",
    players: [5],
    room: 28,
    seconds: 1750,
    monthsBack: 0,
    at: 0.3,
  },
  {
    key: "13",
    mode: "solo",
    players: [6],
    room: 28,
    seconds: 1750,
    monthsBack: 0,
    at: 0.35,
  },
  {
    key: "14",
    mode: "solo",
    players: [5],
    room: 40,
    seconds: 90,
    monthsBack: 0,
    at: 0.4,
    flagReason: "too_fast",
  },
  {
    key: "15",
    mode: "quick",
    players: [6, 8],
    room: 26,
    seconds: 1700,
    monthsBack: 0,
    at: 0.5,
  },
  {
    key: "16",
    mode: "quick",
    players: [2, 5, 7],
    room: 29,
    seconds: 1900,
    monthsBack: 0,
    at: 0.55,
  },
  {
    key: "17",
    mode: "quick",
    players: [4, 8],
    room: 15,
    seconds: 1100,
    monthsBack: 0,
    at: 0.6,
  },
  {
    key: "18",
    mode: "guild",
    players: [1, 2],
    room: 31,
    seconds: 2000,
    monthsBack: 0,
    at: 0.7,
  },
  {
    key: "19",
    mode: "guild",
    players: [2, 3, 4],
    room: 36,
    seconds: 2400,
    monthsBack: 0,
    at: 0.8,
  },
  {
    key: "20",
    mode: "guild",
    players: [1, 2, 3, 4],
    room: 34,
    seconds: 2250,
    monthsBack: 0,
    at: 0.9,
  },
];

interface RecentRunSpec {
  /** Days (fractions allowed) before the seed run. */
  daysAgo: number;
  key: string;
  mode: RunMode;
  /** Player numbers; the first one is the reporting host. */
  players: number[];
  room: number;
  seconds: number;
}

/**
 * Fourteen runs over the last two weeks, so GET /admin/stats/daily shows a series locally.
 * Guild runs only use guild members (players 1-4); the banned player 7 is not involved.
 */
const RECENT_RUNS: RecentRunSpec[] = [
  {
    key: "21",
    mode: "solo",
    players: [9],
    room: 8,
    seconds: 640,
    daysAgo: 0.2,
  },
  {
    key: "22",
    mode: "solo",
    players: [1],
    room: 23,
    seconds: 1550,
    daysAgo: 0.5,
  },
  {
    key: "23",
    mode: "quick",
    players: [5, 9],
    room: 17,
    seconds: 1200,
    daysAgo: 1.3,
  },
  {
    key: "24",
    mode: "guild",
    players: [1, 2, 4],
    room: 32,
    seconds: 2150,
    daysAgo: 1.8,
  },
  {
    key: "25",
    mode: "solo",
    players: [10],
    room: 4,
    seconds: 300,
    daysAgo: 2.1,
  },
  {
    key: "26",
    mode: "solo",
    players: [3],
    room: 14,
    seconds: 1000,
    daysAgo: 3.4,
  },
  {
    key: "27",
    mode: "quick",
    players: [6, 10],
    room: 11,
    seconds: 820,
    daysAgo: 4.2,
  },
  {
    key: "28",
    mode: "solo",
    players: [2],
    room: 26,
    seconds: 1720,
    daysAgo: 5.6,
  },
  {
    key: "29",
    mode: "guild",
    players: [2, 3],
    room: 21,
    seconds: 1500,
    daysAgo: 6.5,
  },
  {
    key: "30",
    mode: "solo",
    players: [5],
    room: 48,
    seconds: 3000,
    daysAgo: 7.7,
  },
  {
    key: "31",
    mode: "solo",
    players: [8],
    room: 9,
    seconds: 700,
    daysAgo: 9.2,
  },
  {
    key: "32",
    mode: "quick",
    players: [1, 5, 6],
    room: 38,
    seconds: 2500,
    daysAgo: 10.5,
  },
  {
    key: "33",
    mode: "solo",
    players: [4],
    room: 55,
    seconds: 3500,
    daysAgo: 12.1,
  },
  {
    key: "34",
    mode: "solo",
    players: [6],
    room: 2,
    seconds: 150,
    daysAgo: 13.9,
  },
];
const RUN_SEED_PREFIX = "dev-seed-";

/** A point inside the given UTC month; the current month ends at `now`. */
function seasonTime(monthsBack: 0 | 1, fraction: number): Date {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() - monthsBack;
  const start = Date.UTC(year, month, 1);
  const end = monthsBack === 0 ? now.getTime() : Date.UTC(year, month + 1, 1);
  return new Date(start + Math.floor((end - start) * fraction));
}

const seasonId = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

interface Summary {
  banCreated: boolean;
  guildCreated: boolean;
  newAdmins: number;
  newDeletions: number;
  newPlayers: number;
  newRuns: number;
  noteCreated: boolean;
}

/**
 * Better Auth user + credential account (P-027), created with PASSWORD when missing. An existing
 * account is left as it is (password, role, enabled), like everything else in this seed.
 */
async function ensureAdmin(
  tx: Tx,
  email: string,
  role: "admin" | "moderator"
): Promise<{ user: User; created: boolean }> {
  const existing = await tx.user.findUnique({ where: { email } });
  if (existing) {
    return { user: existing, created: false };
  }
  const user = await createAdminAccount(tx, {
    email,
    password: PASSWORD,
    role,
  });
  return { user, created: true };
}

/** Finds a seeded player through its device identity or creates player and identity together. */
async function ensurePlayer(
  tx: Tx,
  spec: PlayerSpec
): Promise<{ player: Player; created: boolean }> {
  const identity = await tx.playerIdentity.findUnique({
    where: {
      provider_providerUserId: {
        provider: "device",
        providerUserId: deviceIdOf(spec.n),
      },
    },
    include: { player: true },
  });
  if (identity) {
    return { player: identity.player, created: false };
  }
  const player = await tx.player.create({
    data: {
      name: spec.name,
      createdAt: daysAgo(spec.createdDaysAgo),
      lastSeenAt: daysAgo(spec.seenDaysAgo),
      identities: {
        create: {
          provider: "device",
          providerUserId: deviceIdOf(spec.n),
          createdAt: daysAgo(spec.createdDaysAgo),
          lastUsedAt: daysAgo(spec.seenDaysAgo),
        },
      },
    },
  });
  return { player, created: true };
}

async function seed(tx: Tx): Promise<Summary> {
  const summary: Summary = {
    newPlayers: 0,
    guildCreated: false,
    newRuns: 0,
    banCreated: false,
    noteCreated: false,
    newDeletions: 0,
    newAdmins: 0,
  };

  // --- admins --------------------------------------------------------------------------------
  const adminResult = await ensureAdmin(tx, ADMIN_EMAIL, "admin");
  const moderatorResult = await ensureAdmin(tx, MODERATOR_EMAIL, "moderator");
  const admin = adminResult.user;
  const moderator = moderatorResult.user;
  summary.newAdmins =
    Number(adminResult.created) + Number(moderatorResult.created);
  const moderatorAudit = await tx.auditLog.findFirst({
    where: { action: "admin.create", targetId: moderator.id },
    select: { id: true },
  });
  if (!moderatorAudit) {
    await writeAudit(tx, {
      adminId: admin.id,
      action: "admin.create",
      targetType: "admin_user",
      targetId: moderator.id,
      details: { email: moderator.email, role: moderator.role },
    });
  }

  // --- players (one device identity each) ----------------------------------------------------
  const byNumber = new Map<number, Player>();
  for (const spec of PLAYERS) {
    const { player, created } = await ensurePlayer(tx, spec);
    byNumber.set(spec.n, player);
    if (created) {
      summary.newPlayers += 1;
    }
  }
  const player = (n: number): Player => {
    const row = byNumber.get(n);
    if (!row) {
      throw new Error(`unknown player number ${n}`);
    }
    return row;
  };
  // A second identity for one player (skipped if the fake id was linked elsewhere meanwhile).
  await tx.playerIdentity.createMany({
    data: [
      {
        playerId: player(STEAM_PLAYER).id,
        provider: "steam",
        providerUserId: FAKE_STEAM_ID,
      },
    ],
    skipDuplicates: true,
  });

  // --- guild ---------------------------------------------------------------------------------
  let guild = await tx.guild.findFirst({
    where: { tag: GUILD.tag, disbandedAt: null },
  });
  if (!guild) {
    guild = await tx.guild.create({
      data: {
        name: GUILD.name,
        tag: GUILD.tag,
        inviteCode: GUILD.inviteCode,
        founderId: player(1).id,
        createdAt: daysAgo(GUILD.createdDaysAgo),
      },
    });
    summary.guildCreated = true;
  }
  const guildId = guild.id;
  // A seeded player may have joined another guild while testing; keep that (skipDuplicates).
  await tx.guildMember.createMany({
    data: GUILD.members.map((m) => ({
      guildId,
      playerId: player(m.n).id,
      role: m.role,
      joinedAt: daysAgo(GUILD.createdDaysAgo - m.n),
    })),
    skipDuplicates: true,
  });
  await tx.guildProgress.createMany({
    data: [{ guildId, ...GUILD.progress }],
    skipDuplicates: true,
  });

  // --- runs ----------------------------------------------------------------------------------
  const existingRuns = await tx.run.findMany({
    where: { seed: { startsWith: RUN_SEED_PREFIX } },
    select: { seed: true },
  });
  const existingSeeds = new Set(existingRuns.map((r) => r.seed));
  const allRuns = [
    ...RUNS.map((spec) => ({
      ...spec,
      gameVersion: spec.monthsBack === 1 ? "0.9.0" : "1.0.0",
      createdAt: seasonTime(spec.monthsBack, spec.at),
    })),
    ...RECENT_RUNS.map((spec) => ({
      ...spec,
      flagReason: undefined,
      gameVersion: "1.0.0",
      createdAt: daysAgo(spec.daysAgo),
    })),
  ];
  for (const spec of allRuns) {
    const seedKey = `${RUN_SEED_PREFIX}${spec.key}`;
    if (existingSeeds.has(seedKey)) {
      continue;
    }
    const participantIds = spec.players.map((n) => player(n).id);
    const [reporter] = participantIds;
    if (!reporter) {
      throw new Error(`run ${spec.key} has no participants`);
    }
    await tx.run.create({
      data: {
        mode: spec.mode,
        guildId: spec.mode === "guild" ? guildId : null,
        reportedBy: reporter,
        roomReached: spec.room,
        durationSeconds: spec.seconds,
        seed: seedKey,
        gameVersion: spec.gameVersion,
        createdAt: spec.createdAt,
        flagged: spec.flagReason !== undefined,
        flagReason: spec.flagReason ?? null,
        participants: {
          create: participantIds.map((playerId) => ({ playerId })),
        },
      },
    });
    summary.newRuns += 1;
  }

  // --- temporary ban (by the moderator, with audit entry) -------------------------------------
  const banned = player(BANNED_PLAYER);
  const existingBan = await tx.ban.findFirst({
    where: { playerId: banned.id, reason: BAN_REASON },
    select: { id: true },
  });
  if (!existingBan) {
    const ban = await tx.ban.create({
      data: {
        playerId: banned.id,
        reason: BAN_REASON,
        createdByAdminId: moderator.id,
        createdAt: now,
        expiresAt: new Date(now.getTime() + BAN_DAYS * DAY_MS),
      },
    });
    await writeAudit(tx, {
      adminId: moderator.id,
      action: "player.ban",
      targetType: "player",
      targetId: banned.id,
      details: { banId: ban.id, reason: BAN_REASON, durationDays: BAN_DAYS },
    });
    summary.banCreated = true;
  }

  // --- moderation note on the banned player (P-023) -----------------------------------------
  const existingNote = await tx.playerNote.findFirst({
    where: { playerId: banned.id, text: NOTE_TEXT },
    select: { id: true },
  });
  if (!existingNote) {
    const note = await tx.playerNote.create({
      data: {
        playerId: banned.id,
        adminId: moderator.id,
        text: NOTE_TEXT,
        createdAt: daysAgo(0.1),
      },
    });
    await writeAudit(tx, {
      adminId: moderator.id,
      action: "player.note_add",
      targetType: "player",
      targetId: banned.id,
      details: { noteId: note.id, text: NOTE_TEXT },
    });
    summary.noteCreated = true;
  }

  // --- deletion log (P-026) ------------------------------------------------------------------
  const { count: newDeletions } = await tx.accountDeletion.createMany({
    data: DELETIONS.map((d) => ({
      id: d.id,
      channel: d.channel,
      wasBanned: d.wasBanned,
      deletedAt: daysAgo(d.daysAgo),
    })),
    skipDuplicates: true,
  });
  summary.newDeletions = newDeletions;

  return summary;
}

const db = createPrisma(process.env.DATABASE_URL ?? "");
try {
  // Argon2 hashing plus the inserts take longer than Prisma's default 5 s transaction timeout.
  const summary = await db.$transaction(seed, { timeout: 60_000 });
  const banExpires = new Date(now.getTime() + BAN_DAYS * DAY_MS);
  const passwordInfo = PASSWORD_FROM_ENV
    ? "(from DEFAULT_ADMIN_PASSWORD)"
    : `"${PASSWORD}"`;
  const bannedName =
    PLAYERS.find((p) => p.n === BANNED_PLAYER)?.name ??
    `player ${BANNED_PLAYER}`;
  console.log(
    [
      "Dev seed applied.",
      `  Admins:   ${ADMIN_EMAIL} (admin), ${MODERATOR_EMAIL} (moderator), ${summary.newAdmins} new; new accounts get the password ${passwordInfo}, existing ones keep theirs`,
      `  Players:  ${PLAYERS.length} (${summary.newPlayers} new); device ids ${deviceIdOf(1)} ... ${deviceIdOf(PLAYERS.length)}; player ${STEAM_PLAYER} also has the fake Steam id ${FAKE_STEAM_ID}`,
      `  Guild:    ${GUILD.name} [${GUILD.tag}], invite code ${GUILD.inviteCode}, ${GUILD.members.length} members${summary.guildCreated ? "" : " (existed)"}`,
      `  Runs:     ${RUNS.length + RECENT_RUNS.length} (${summary.newRuns} new), 1 flagged, seasons ${seasonId(seasonTime(1, 0))} and ${seasonId(now)}, ${RECENT_RUNS.length} in the last two weeks`,
      `  Ban:      ${bannedName} until ${banExpires.toISOString()}${summary.banCreated ? "" : " (existed)"}`,
      `  Note:     moderation note on ${bannedName}${summary.noteCreated ? "" : " (existed)"}`,
      `  Deleted:  ${DELETIONS.length} entries in the deletion log (${summary.newDeletions} new)`,
      "  Web:      http://localhost:3000/ranglisten - Admin: http://localhost:3001",
    ].join("\n")
  );
} finally {
  await db.$disconnect();
}
