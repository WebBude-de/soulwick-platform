/*
  Warnings:

  - You are about to drop the `account_deletion_requests` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "account_deletion_channel" AS ENUM ('web_code', 'in_game', 'admin');

-- DropForeignKey
ALTER TABLE "account_deletion_requests" DROP CONSTRAINT "account_deletion_requests_player_id_fkey";

-- DropForeignKey
ALTER TABLE "account_deletion_requests" DROP CONSTRAINT "account_deletion_requests_resolved_by_fkey";

-- DropTable
DROP TABLE "account_deletion_requests";

-- DropEnum
DROP TYPE "deletion_request_status";

-- CreateTable
CREATE TABLE "deletion_codes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "player_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "deletion_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_deletions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "deleted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "channel" "account_deletion_channel" NOT NULL,
    "was_banned" BOOLEAN NOT NULL DEFAULT false,
    "player_hash" TEXT,

    CONSTRAINT "account_deletions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "deletion_codes_player_id_unique" ON "deletion_codes"("player_id");

-- CreateIndex
CREATE UNIQUE INDEX "deletion_codes_code_hash_unique" ON "deletion_codes"("code_hash");

-- CreateIndex
CREATE INDEX "account_deletions_deleted_at_idx" ON "account_deletions"("deleted_at");

-- CreateIndex
CREATE INDEX "account_deletions_player_hash_idx" ON "account_deletions"("player_hash");

-- AddForeignKey
ALTER TABLE "deletion_codes" ADD CONSTRAINT "deletion_codes_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;
