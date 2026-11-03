import type { IdentitySummary, PlayerAppearance } from "@soulwick/contracts";
import type {
  Db,
  IdentityProvider,
  Player,
  PlayerIdentity,
} from "@soulwick/db";
import { ApiError, isUniqueViolation } from "../lib/errors.ts";
import { maskEmail } from "../lib/mail.ts";
import { iso } from "../lib/validate.ts";
import { queueAppleRevocations } from "./apple.ts";
import type { DbOrTx } from "./db-types.ts";
import { clearPlayerEmail, realEmailOf } from "./player-users.ts";
import { appearanceData } from "./profile.ts";

type IdentityRef = Pick<PlayerIdentity, "provider" | "providerUserId">;

/**
 * Contract fields derived from the identities (P-014): `steamId` on the player and admin views,
 * `hasDeviceId` on the admin views. They stay for older game builds; the full list is
 * GET /me/identities.
 */
export function steamIdOf(identities: IdentityRef[]): string | null {
  return identities.find((i) => i.provider === "steam")?.providerUserId ?? null;
}

export function hasDeviceIdentity(identities: IdentityRef[]): boolean {
  return identities.some((i) => i.provider === "device");
}

export function findIdentities(
  db: DbOrTx,
  playerId: string
): Promise<PlayerIdentity[]> {
  return db.playerIdentity.findMany({
    where: { playerId },
    orderBy: { createdAt: "asc" },
  });
}

/** Whether an identity is already known (POST /auth/device counts only new guest accounts). */
export async function identityExists(
  db: Db,
  provider: IdentityProvider,
  providerUserId: string
): Promise<boolean> {
  const row = await db.playerIdentity.findUnique({
    where: { provider_providerUserId: { provider, providerUserId } },
    select: { id: true },
  });
  return row !== null;
}

/**
 * Login through one identity: returns the player behind it (touching `last_used_at` and
 * `last_seen_at`) or creates player and identity together. The name is only used on creation.
 * Two first logins of the same identity at once: the loser of the unique race re-reads.
 */
export async function loginWithIdentity(
  db: Db,
  input: {
    provider: IdentityProvider;
    providerUserId: string;
    name: string;
    /** Character of a new account (P-034); ignored for existing accounts. */
    appearance?: PlayerAppearance;
    now: Date;
  }
): Promise<{ player: Player; created: boolean }> {
  const { provider, providerUserId, name, now } = input;
  const key = { provider_providerUserId: { provider, providerUserId } };

  const existing = await db.playerIdentity.findUnique({ where: key });
  if (existing) {
    const player = await db.player.update({
      where: { id: existing.playerId },
      data: {
        lastSeenAt: now,
        identities: {
          update: { where: { id: existing.id }, data: { lastUsedAt: now } },
        },
      },
    });
    return { player, created: false };
  }

  try {
    const player = await db.player.create({
      data: {
        name,
        appearance: appearanceData(input.appearance),
        lastSeenAt: now,
        identities: { create: { provider, providerUserId, lastUsedAt: now } },
      },
    });
    return { player, created: true };
  } catch (err) {
    if (!isUniqueViolation(err)) {
      throw err;
    }
    const raced = await db.playerIdentity.findUnique({
      where: key,
      include: { player: true },
    });
    if (!raced) {
      throw err;
    }
    return { player: raced.player, created: false };
  }
}

/** Characters of the provider user id that stay visible in `maskedId`. */
const VISIBLE_ID_CHARS = 4;

/** "***0001": enough to tell two devices apart, never the full provider id (KONZEPT §3.5). */
export function maskProviderUserId(providerUserId: string): string {
  return `***${providerUserId.slice(-VISIBLE_ID_CHARS)}`;
}

/**
 * One identity for the owner's account panel. `email` = the proven address of the account
 * (`auth_users.email`, P-037), shown masked; `password` shows its username (the owner's own).
 */
export function toIdentitySummary(
  identity: PlayerIdentity,
  email: string | null = null
): IdentitySummary {
  let maskedId = maskProviderUserId(identity.providerUserId);
  let label: string | null = null;
  if (identity.provider === "email") {
    maskedId = email ? maskEmail(email) : "***";
    label = maskedId;
  } else if (identity.provider === "password") {
    label = identity.providerUserId;
  }
  return {
    id: identity.id,
    provider: identity.provider,
    maskedId,
    label,
    createdAt: iso(identity.createdAt),
    lastUsedAt: iso(identity.lastUsedAt),
  };
}

export async function listIdentitySummaries(
  db: DbOrTx,
  playerId: string
): Promise<IdentitySummary[]> {
  const identities = await findIdentities(db, playerId);
  const email = identities.some((i) => i.provider === "email")
    ? realEmailOf(await db.user.findUnique({ where: { playerId } }))
    : null;
  return identities.map((i) => toIdentitySummary(i, email));
}

/**
 * Unlinks every identity of one provider from the account (D-121). A device that logs in with an
 * unlinked identity afterwards gets a new account. The Better Auth rows of those identities go
 * with them (P-037), Apple refresh tokens are queued for revocation, an unlinked e-mail address
 * is removed from the account. `revocations` > 0: the caller should send them
 * (`sendRevocations`). Errors: 404 `identity_not_found`, 409 `last_identity` when nothing
 * would be left.
 */
export async function unlinkProvider(
  db: Db,
  playerId: string,
  provider: IdentityProvider
): Promise<{ removed: number; revocations: number }> {
  return await db.$transaction(async (tx) => {
    // Lock the account so two parallel unlinks cannot remove the last identities together.
    await tx.$queryRaw`select id from players where id = ${playerId}::uuid for update`;
    const identities = await findIdentities(tx, playerId);
    const matching = identities.filter((i) => i.provider === provider);
    if (matching.length === 0) {
      throw new ApiError(
        404,
        "identity_not_found",
        `No ${provider} identity on this account`
      );
    }
    if (matching.length === identities.length) {
      throw new ApiError(
        409,
        "last_identity",
        "The last identity of an account cannot be unlinked"
      );
    }
    const accountIds = matching.flatMap((i) =>
      i.authAccountId ? [i.authAccountId] : []
    );
    const revocations =
      accountIds.length > 0
        ? await queueAppleRevocations(tx, { ids: accountIds })
        : 0;
    const { count } = await tx.playerIdentity.deleteMany({
      where: { playerId, provider },
    });
    if (accountIds.length > 0) {
      await tx.account.deleteMany({ where: { id: { in: accountIds } } });
    }
    if (provider === "email") {
      await clearPlayerEmail(tx, playerId);
    }
    return { removed: count, revocations };
  });
}
