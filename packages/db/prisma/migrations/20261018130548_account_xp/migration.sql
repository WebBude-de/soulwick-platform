-- AlterTable
ALTER TABLE "players" ADD COLUMN     "xp" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "xp_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "player_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "xp" INTEGER NOT NULL,
    "rooms" INTEGER NOT NULL,
    "champions" INTEGER NOT NULL,
    "bosses" INTEGER NOT NULL,
    "deepest_room" INTEGER NOT NULL,
    "record_rooms" INTEGER NOT NULL,
    "first_run_of_day" BOOLEAN NOT NULL,
    "end_reason" TEXT NOT NULL,
    "players" INTEGER NOT NULL,
    "duration_seconds" INTEGER NOT NULL,
    "game_version" TEXT NOT NULL,
    "ended_at" TIMESTAMPTZ(6) NOT NULL,
    "day" DATE NOT NULL,
    "flag_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "xp_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "xp_entries_player_id_created_at_idx" ON "xp_entries"("player_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "xp_entries_player_run_uq" ON "xp_entries"("player_id", "run_id");

-- AddForeignKey
ALTER TABLE "xp_entries" ADD CONSTRAINT "xp_entries_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;
