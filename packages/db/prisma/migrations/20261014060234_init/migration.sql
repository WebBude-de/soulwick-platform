-- CreateEnum
CREATE TYPE "run_mode" AS ENUM ('solo', 'quick', 'guild');

-- CreateEnum
CREATE TYPE "guild_role" AS ENUM ('founder', 'officer', 'member');

-- CreateEnum
CREATE TYPE "admin_role" AS ENUM ('admin', 'moderator');

-- CreateEnum
CREATE TYPE "identity_provider" AS ENUM ('steam', 'device', 'google_play', 'game_center');

-- CreateEnum
CREATE TYPE "legal_document_type" AS ENUM ('imprint', 'privacy_policy', 'privacy_policy_social_media');

-- CreateTable
CREATE TABLE "players" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "players_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_identities" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "player_id" UUID NOT NULL,
    "provider" "identity_provider" NOT NULL,
    "provider_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "player_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "admin_role" NOT NULL DEFAULT 'moderator',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disabled_at" TIMESTAMPTZ(6),

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "player_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by_admin_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_by" UUID,

    CONSTRAINT "bans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "admin_id" UUID,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT,
    "details" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guilds" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "invite_code" TEXT NOT NULL,
    "founder_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disbanded_at" TIMESTAMPTZ(6),

    CONSTRAINT "guilds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guild_members" (
    "guild_id" UUID NOT NULL,
    "player_id" UUID NOT NULL,
    "role" "guild_role" NOT NULL DEFAULT 'member',
    "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guild_members_pkey" PRIMARY KEY ("guild_id","player_id")
);

-- CreateTable
CREATE TABLE "guild_progress" (
    "guild_id" UUID NOT NULL,
    "treasury" INTEGER NOT NULL DEFAULT 0,
    "forge_levels" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "guild_progress_pkey" PRIMARY KEY ("guild_id")
);

-- CreateTable
CREATE TABLE "runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "mode" "run_mode" NOT NULL,
    "guild_id" UUID,
    "reported_by" UUID,
    "room_reached" INTEGER NOT NULL,
    "duration_seconds" INTEGER NOT NULL,
    "seed" TEXT NOT NULL,
    "game_version" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "flag_reason" TEXT,

    CONSTRAINT "runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "run_players" (
    "run_id" UUID NOT NULL,
    "player_id" UUID NOT NULL,

    CONSTRAINT "run_players_pkey" PRIMARY KEY ("run_id","player_id")
);

-- CreateTable
CREATE TABLE "legal_documents" (
    "type" "legal_document_type" NOT NULL,
    "html_de" TEXT,
    "html_en" TEXT,
    "source_created_at" TIMESTAMPTZ(6),
    "source_modified_at" TIMESTAMPTZ(6),
    "fetched_at" TIMESTAMPTZ(6),
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_documents_pkey" PRIMARY KEY ("type")
);

-- CreateTable
CREATE TABLE "erecht24_push_clients" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" INTEGER NOT NULL,
    "secret" TEXT NOT NULL,
    "push_uri" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "erecht24_push_clients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "player_identities_player_id_idx" ON "player_identities"("player_id");

-- CreateIndex
CREATE UNIQUE INDEX "player_identities_provider_user_uq" ON "player_identities"("provider", "provider_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_unique" ON "admin_users"("email");

-- CreateIndex
CREATE INDEX "bans_player_id_idx" ON "bans"("player_id");

-- CreateIndex
CREATE INDEX "audit_log_created_at_idx" ON "audit_log"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "guilds_invite_code_unique" ON "guilds"("invite_code");

-- CreateIndex
CREATE UNIQUE INDEX "guild_members_player_id_unique" ON "guild_members"("player_id");

-- CreateIndex
CREATE INDEX "guild_members_guild_id_idx" ON "guild_members"("guild_id");

-- CreateIndex
CREATE INDEX "runs_mode_created_at_idx" ON "runs"("mode", "created_at");

-- CreateIndex
CREATE INDEX "runs_guild_id_idx" ON "runs"("guild_id");

-- CreateIndex
CREATE INDEX "runs_flagged_idx" ON "runs"("flagged", "created_at");

-- CreateIndex
CREATE INDEX "run_players_player_id_idx" ON "run_players"("player_id");

-- AddForeignKey
ALTER TABLE "player_identities" ADD CONSTRAINT "player_identities_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bans" ADD CONSTRAINT "bans_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bans" ADD CONSTRAINT "bans_created_by_admin_id_fkey" FOREIGN KEY ("created_by_admin_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bans" ADD CONSTRAINT "bans_revoked_by_fkey" FOREIGN KEY ("revoked_by") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guilds" ADD CONSTRAINT "guilds_founder_id_fkey" FOREIGN KEY ("founder_id") REFERENCES "players"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guild_members" ADD CONSTRAINT "guild_members_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guild_members" ADD CONSTRAINT "guild_members_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guild_progress" ADD CONSTRAINT "guild_progress_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runs" ADD CONSTRAINT "runs_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runs" ADD CONSTRAINT "runs_reported_by_fkey" FOREIGN KEY ("reported_by") REFERENCES "players"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_players" ADD CONSTRAINT "run_players_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_players" ADD CONSTRAINT "run_players_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written (P-101): name and tag are unique among active guilds only; a disbanded guild frees
-- them again. Prisma cannot express partial or expression indexes, so they live here and
-- packages/db/scripts/schema-diff.ts knows them. Keep both when editing later migrations.
CREATE UNIQUE INDEX "guilds_name_active_uq" ON "guilds" (lower("name")) WHERE "disbanded_at" IS NULL;
CREATE UNIQUE INDEX "guilds_tag_active_uq" ON "guilds" ("tag") WHERE "disbanded_at" IS NULL;
