-- CreateEnum
CREATE TYPE "cloud_world_status" AS ENUM ('active', 'archived');

-- CreateEnum
CREATE TYPE "cloud_world_source" AS ENUM ('upload', 'restore', 'account_merge');

-- CreateEnum
CREATE TYPE "cloud_world_backup_reason" AS ENUM ('merge', 'restore', 'account_merge');

-- CreateTable
CREATE TABLE "cloud_worlds" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "player_id" UUID NOT NULL,
    "world_id" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "status" "cloud_world_status" NOT NULL DEFAULT 'active',
    "source" "cloud_world_source" NOT NULL DEFAULT 'upload',
    "data" JSONB NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "format_version" INTEGER NOT NULL,
    "game_version" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "deepest_room" INTEGER NOT NULL,
    "forge_level" INTEGER NOT NULL,
    "forge_max" INTEGER NOT NULL,
    "play_time_seconds" INTEGER NOT NULL,
    "last_played_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),

    CONSTRAINT "cloud_worlds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cloud_world_backups" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cloud_world_id" UUID NOT NULL,
    "reason" "cloud_world_backup_reason" NOT NULL,
    "from_revision" INTEGER,
    "pending_merge" BOOLEAN NOT NULL DEFAULT false,
    "data" JSONB NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "format_version" INTEGER NOT NULL,
    "game_version" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "deepest_room" INTEGER NOT NULL,
    "forge_level" INTEGER NOT NULL,
    "forge_max" INTEGER NOT NULL,
    "play_time_seconds" INTEGER NOT NULL,
    "last_played_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "cloud_world_backups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cloud_worlds_status_expires_at_idx" ON "cloud_worlds"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "cloud_worlds_player_world_uq" ON "cloud_worlds"("player_id", "world_id");

-- CreateIndex
CREATE INDEX "cloud_world_backups_world_created_at_idx" ON "cloud_world_backups"("cloud_world_id", "created_at");

-- CreateIndex
CREATE INDEX "cloud_world_backups_expires_at_idx" ON "cloud_world_backups"("expires_at");

-- AddForeignKey
ALTER TABLE "cloud_worlds" ADD CONSTRAINT "cloud_worlds_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cloud_world_backups" ADD CONSTRAINT "cloud_world_backups_cloud_world_id_fkey" FOREIGN KEY ("cloud_world_id") REFERENCES "cloud_worlds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
