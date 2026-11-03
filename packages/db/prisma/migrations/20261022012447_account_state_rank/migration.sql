-- AlterTable
ALTER TABLE "xp_entries" ADD COLUMN     "danger" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "account_states" (
    "player_id" UUID NOT NULL,
    "talents" JSONB NOT NULL DEFAULT '{}',
    "spells" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "changed_at" TIMESTAMPTZ(6),
    "seen" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "account_states_pkey" PRIMARY KEY ("player_id")
);

-- CreateIndex
CREATE INDEX "xp_entries_player_id_ended_at_idx" ON "xp_entries"("player_id", "ended_at" DESC);

-- AddForeignKey
ALTER TABLE "account_states" ADD CONSTRAINT "account_states_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;
