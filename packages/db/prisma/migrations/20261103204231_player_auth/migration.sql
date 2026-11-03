/*
  Warnings:

  - A unique constraint covering the columns `[auth_account_id]` on the table `player_identities` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "web_login_intent" AS ENUM ('sign_in', 'link');

-- CreateEnum
CREATE TYPE "web_login_status" AS ENUM ('pending', 'confirm_merge', 'completed', 'failed', 'collected');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "identity_provider" ADD VALUE 'password';
ALTER TYPE "identity_provider" ADD VALUE 'email';
ALTER TYPE "identity_provider" ADD VALUE 'google';
ALTER TYPE "identity_provider" ADD VALUE 'apple';
ALTER TYPE "identity_provider" ADD VALUE 'discord';

-- AlterTable
ALTER TABLE "auth_accounts" ADD COLUMN     "client_id" TEXT;

-- AlterTable
ALTER TABLE "player_identities" ADD COLUMN     "auth_account_id" UUID;

-- CreateTable
CREATE TABLE "web_login_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code_hash" TEXT NOT NULL,
    "poll_secret_hash" TEXT NOT NULL,
    "intent" "web_login_intent" NOT NULL,
    "player_id" UUID,
    "status" "web_login_status" NOT NULL DEFAULT 'pending',
    "provider" "identity_provider",
    "result_player_id" UUID,
    "merged" BOOLEAN NOT NULL DEFAULT false,
    "removed_player_id" UUID,
    "error" TEXT,
    "confirm_secret_hash" TEXT,
    "pending_login" JSONB,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "completed_at" TIMESTAMPTZ(6),

    CONSTRAINT "web_login_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_token_revocations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "token_type" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_token_revocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "web_login_requests_code_hash_unique" ON "web_login_requests"("code_hash");

-- CreateIndex
CREATE INDEX "web_login_requests_expires_at_idx" ON "web_login_requests"("expires_at");

-- CreateIndex
CREATE INDEX "oauth_token_revocations_next_attempt_at_idx" ON "oauth_token_revocations"("next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "player_identities_auth_account_id_unique" ON "player_identities"("auth_account_id");

-- AddForeignKey
ALTER TABLE "player_identities" ADD CONSTRAINT "player_identities_auth_account_id_fkey" FOREIGN KEY ("auth_account_id") REFERENCES "auth_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "web_login_requests" ADD CONSTRAINT "web_login_requests_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "web_login_requests" ADD CONSTRAINT "web_login_requests_result_player_id_fkey" FOREIGN KEY ("result_player_id") REFERENCES "players"("id") ON DELETE SET NULL ON UPDATE CASCADE;
