import type { PlayerAppearance } from "@soulwick/contracts";
import type { IdentityProvider, Player, PlayerIdentity } from "@soulwick/db";
import { ApiError, isUniqueViolation, withCause } from "../lib/errors.ts";
import { type LinkResult, mergeAccountsInTx } from "./account-link.ts";
import type { Db, Tx } from "./db-types.ts";
import { hashPassword, verifyPassword } from "./passwords.ts";
import { ensurePlayerUser, realEmailOf } from "./player-users.ts";
import { appearanceData, defaultPlayerName } from "./profile.ts";

/**
 * Player logins of KF5 on the account model of P-037: `player_identities` is the one list of
 * which login belongs to which account; a login with a secret has exactly one Better Auth row in
 * `auth_accounts` (`player_identities.auth_account_id`), created, moved and deleted together.
 * The e-mail of a magic link lives in `auth_users.email` of the player, its identity points there
 * (`provider_user_id` = user id). Nothing is ever linked through a matching e-mail address.
 */

/** A login whose proof was checked (password, magic link, OAuth, Apple, Steam, Game Center, ...). */
export interface VerifiedLogin {
  /** Better Auth row for the secret of this login (P-037), if it has one. */
  account?: {
    providerId: string;
    accountId?: string;
    /** argon2id hash (`password`). */
    password?: string;
    /** Encrypted refresh token (Apple). */
    refreshToken?: string | null;
    clientId?: string;
  };
  /** Character of a new account (P-034); only used when the account is created. */
  appearance?: PlayerAppearance;
  /** Display name of a new account; default `Spieler-1234`. */
  name?: string;
  provider: IdentityProvider;
  /** Provider user id; for `email` the (lower-case) address, for `password` the username. */
  providerUserId: string;
}

/** Transactions of this module touch a few tables and may wait for row locks. */
const LOGIN_TIMEOUT_MS = 15_000;

/** The identity of a login and the player it belongs to, or null if nobody has it yet. */
export async function findLoginOwner(
  tx: Tx | Db,
  login: Pick<VerifiedLogin, "provider" | "providerUserId">
): Promise<PlayerIdentity | null> {
  if (login.provider === "email") {
    const user = await tx.user.findUnique({
      where: { email: login.providerUserId },
    });
    if (!user) {
      return null;
    }
    if (!user.playerId) {
      // An admin address: players cannot use it (P-037, one address per auth_users row).
      throw new ApiError(
        409,
        "email_unavailable",
        "This e-mail address cannot be used"
      );
    }
    return await tx.playerIdentity.findFirst({
      where: { provider: "email", providerUserId: user.id },
    });
  }
  return await tx.playerIdentity.findUnique({
    where: {
      provider_providerUserId: {
        provider: login.provider,
        providerUserId: login.providerUserId,
      },
    },
  });
}

/**
 * Adds the identity of `login` to `playerId` (identity, Better Auth row, e-mail; P-037). An
 * account has one e-mail: a newly proven address replaces the previous one.
 */
async function createIdentity(
  tx: Tx,
  playerId: string,
  login: VerifiedLogin,
  now: Date
): Promise<PlayerIdentity> {
  const user = await ensurePlayerUser(tx, playerId);
  if (login.provider === "email") {
    await tx.playerIdentity.deleteMany({
      where: { playerId, provider: "email" },
    });
    await tx.user.update({
      where: { id: user.id },
      data: { email: login.providerUserId, emailVerified: true },
    });
    return await tx.playerIdentity.create({
      data: {
        playerId,
        provider: "email",
        providerUserId: user.id,
        lastUsedAt: now,
      },
    });
  }
  let authAccountId: string | undefined;
  if (login.account) {
    const row = await tx.account.create({
      data: {
        userId: user.id,
        providerId: login.account.providerId,
        accountId: login.account.accountId ?? user.id,
        password: login.account.password ?? null,
        refreshToken: login.account.refreshToken ?? null,
        clientId: login.account.clientId ?? null,
      },
    });
    authAccountId = row.id;
  }
  return await tx.playerIdentity.create({
    data: {
      playerId,
      provider: login.provider,
      providerUserId: login.providerUserId,
      lastUsedAt: now,
      authAccountId,
    },
  });
}

/**
 * Marks a login as used (identity and the account `playerId`, by default its owner); a new Apple
 * refresh token replaces the stored one.
 */
async function touchIdentity(
  tx: Tx | Db,
  identity: PlayerIdentity,
  login: VerifiedLogin,
  now: Date,
  playerId = identity.playerId
): Promise<Player> {
  const refreshToken = login.account?.refreshToken;
  if (identity.authAccountId && refreshToken) {
    await tx.account.update({
      where: { id: identity.authAccountId },
      data: { refreshToken, clientId: login.account?.clientId ?? null },
    });
  }
  await tx.playerIdentity.update({
    where: { id: identity.id },
    data: { lastUsedAt: now },
  });
  return await tx.player.update({
    where: { id: playerId },
    data: { lastSeenAt: now },
  });
}

/** Unique race of two first logins with the same new login: the loser runs once more. */
async function retryOnUnique<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (!isUniqueViolation(err)) {
      throw err;
    }
    return await run();
  }
}

/** Sign-in inside a transaction: the account behind the login, created with it if new. */
export async function findOrCreatePlayerInTx(
  tx: Tx,
  login: VerifiedLogin,
  now: Date
): Promise<{ player: Player; created: boolean }> {
  const identity = await findLoginOwner(tx, login);
  if (identity) {
    return {
      player: await touchIdentity(tx, identity, login, now),
      created: false,
    };
  }
  const player = await tx.player.create({
    data: {
      name: login.name ?? defaultPlayerName(),
      appearance: appearanceData(login.appearance),
      lastSeenAt: now,
    },
  });
  await createIdentity(tx, player.id, login, now);
  return { player, created: true };
}

/** Sign-in with a verified login (find or create the account); bans are checked by the caller. */
export async function findOrCreatePlayer(
  db: Db,
  login: VerifiedLogin,
  now: Date
): Promise<{ player: Player; created: boolean }> {
  return await retryOnUnique(() =>
    db.$transaction((tx) => findOrCreatePlayerInTx(tx, login, now), {
      timeout: LOGIN_TIMEOUT_MS,
    })
  );
}

/** Result of adding a login to an account. */
export interface AddLoginResult {
  merged: boolean;
  /** The account the login is on now (the caller's, or the other one if the caller's was absorbed). */
  remaining: Player;
  removedPlayerId: string | null;
}

/**
 * "Add login" inside a transaction (P-036 (2)): the proven login goes to `playerId`. Already on
 * this account: nothing changes. New: identity created. On another account: the accounts are
 * joined by D-122/D-188 (`mergeAccountsInTx`, owner = the account with the login), which throws
 * 409 `account_has_progress` (before writing) when both have progress and `confirmMerge` is
 * false, and 409 `merge_blocked_banned`.
 */
export async function addLoginInTx(
  tx: Tx,
  input: {
    playerId: string;
    login: VerifiedLogin;
    confirmMerge: boolean;
    now: Date;
  }
): Promise<AddLoginResult> {
  const { playerId, login, confirmMerge, now } = input;
  await tx.$queryRaw`select id from players where id = ${playerId}::uuid for update`;
  const player = await tx.player.findUnique({ where: { id: playerId } });
  if (!player) {
    throw new ApiError(404, "account_gone", "The account does not exist");
  }
  const identity = await findLoginOwner(tx, login);
  if (!identity) {
    await createIdentity(tx, playerId, login, now);
    return { remaining: player, removedPlayerId: null, merged: false };
  }
  if (identity.playerId === playerId) {
    return {
      remaining: await touchIdentity(tx, identity, login, now),
      removedPlayerId: null,
      merged: false,
    };
  }
  const result: LinkResult = await mergeAccountsInTx(tx, {
    ownerId: identity.playerId,
    callerId: playerId,
    confirmMerge,
    now,
  });
  // The login moved with its account. Only an e-mail can be gone: the kept account had its own
  // address (`moveAuthRows`); the address just proven replaces it then.
  const moved = await findLoginOwner(tx, login);
  if (moved) {
    await touchIdentity(tx, moved, login, now, result.remaining.id);
  } else {
    await createIdentity(tx, result.remaining.id, login, now);
  }
  return {
    remaining: result.remaining,
    removedPlayerId: result.removedPlayerId,
    merged: result.merged,
  };
}

/** POST /me/logins: `addLoginInTx` in its own transaction. */
export async function addLogin(
  db: Db,
  input: {
    playerId: string;
    login: VerifiedLogin;
    confirmMerge: boolean;
    now: Date;
  }
): Promise<AddLoginResult> {
  return await retryOnUnique(() =>
    db.$transaction((tx) => addLoginInTx(tx, input), {
      timeout: LOGIN_TIMEOUT_MS,
    })
  );
}

// --- username and password ------------------------------------------------------------------------

/** Better Auth's provider id of password hashes. */
const CREDENTIAL = "credential";

/**
 * POST /auth/password: the verified login of username + password, or null (unknown username or
 * wrong password; an unknown username costs a hash too, so the timing tells nothing).
 */
export async function verifyPasswordLogin(
  db: Db,
  username: string,
  password: string
): Promise<VerifiedLogin | null> {
  const identity = await db.playerIdentity.findUnique({
    where: {
      provider_providerUserId: {
        provider: "password",
        providerUserId: username.trim().toLowerCase(),
      },
    },
    include: { authAccount: { select: { password: true } } },
  });
  const hash = identity?.authAccount?.password;
  if (!(identity && hash)) {
    await hashPassword(password);
    return null;
  }
  if (!(await verifyPassword(hash, password))) {
    return null;
  }
  return { provider: "password", providerUserId: identity.providerUserId };
}

const usernameTaken = (cause?: unknown) =>
  withCause(
    new ApiError(409, "username_taken", "This username is already taken"),
    cause
  );

/**
 * PUT /me/logins/password: adds the password login (username and password needed) or changes
 * username and/or password of the existing one (the most recently used if a merge left two).
 * The session is the proof. 409 `username_taken`.
 */
export async function setPasswordLogin(
  db: Db,
  input: {
    playerId: string;
    username?: string;
    password?: string;
    now: Date;
  }
): Promise<void> {
  const { playerId, username, password, now } = input;
  // Hash outside the transaction: argon2id takes a moment and holds no locks.
  const hash =
    password === undefined ? undefined : await hashPassword(password);
  try {
    await db.$transaction(
      async (tx) => {
        await tx.$queryRaw`select id from players where id = ${playerId}::uuid for update`;
        const current = await tx.playerIdentity.findFirst({
          where: { playerId, provider: "password" },
          orderBy: { lastUsedAt: "desc" },
        });
        if (username !== undefined) {
          const holder = await tx.playerIdentity.findUnique({
            where: {
              provider_providerUserId: {
                provider: "password",
                providerUserId: username,
              },
            },
          });
          if (holder && holder.id !== current?.id) {
            throw usernameTaken();
          }
        }
        if (!current) {
          if (!(username && hash)) {
            throw new ApiError(
              400,
              "validation_error",
              "username and password required"
            );
          }
          await createIdentity(
            tx,
            playerId,
            {
              provider: "password",
              providerUserId: username,
              account: { providerId: CREDENTIAL, password: hash },
            },
            now
          );
          return;
        }
        if (username !== undefined && username !== current.providerUserId) {
          await tx.playerIdentity.update({
            where: { id: current.id },
            data: { providerUserId: username },
          });
        }
        if (hash !== undefined) {
          if (current.authAccountId) {
            await tx.account.update({
              where: { id: current.authAccountId },
              data: { password: hash },
            });
          } else {
            const user = await ensurePlayerUser(tx, playerId);
            const row = await tx.account.create({
              data: {
                userId: user.id,
                providerId: CREDENTIAL,
                accountId: user.id,
                password: hash,
              },
            });
            await tx.playerIdentity.update({
              where: { id: current.id },
              data: { authAccountId: row.id },
            });
          }
        }
      },
      { timeout: LOGIN_TIMEOUT_MS }
    );
  } catch (err) {
    // The only unique value written here is the username (a parallel request took it).
    if (isUniqueViolation(err)) {
      throw usernameTaken(err);
    }
    throw err;
  }
}

/** The proven e-mail address of a player (for labels), or null. */
export async function playerEmail(
  db: Db | Tx,
  playerId: string
): Promise<string | null> {
  return realEmailOf(await db.user.findUnique({ where: { playerId } }));
}
