import { PrismaPg } from "@prisma/adapter-pg";
import { type Prisma, PrismaClient } from "../generated/prisma/client";

/**
 * Creates a Prisma client on its own node-postgres pool. Deliberately not a singleton: the API
 * creates one at start-up and hands it around via `Deps`, tests create one per throwaway
 * database. Call `$disconnect()` when done. Only apps/api may import this package.
 */
export function createPrisma(
  connectionString: string,
  options: { max?: number } = {}
): PrismaClient {
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  const adapter = new PrismaPg({ connectionString, max: options.max ?? 10 });
  return new PrismaClient({ adapter });
}

export type Db = PrismaClient;
/** The client handed to the callback of `db.$transaction(async (tx) => ...)`. */
export type Tx = Prisma.TransactionClient;
export type DbOrTx = Db | Tx;

export type {
  Account,
  AccountDeletion,
  AuditLog,
  Ban,
  BugReport,
  DeletionCode,
  Guild,
  GuildMember,
  GuildProgress,
  Jwks,
  LinkCode,
  Player,
  PlayerIdentity,
  PlayerNameChange,
  PlayerNote,
  Run,
  RunPlayer,
  Session,
  User,
} from "../generated/prisma/client";
export { Prisma, PrismaClient } from "../generated/prisma/client";
export * from "../generated/prisma/enums";
