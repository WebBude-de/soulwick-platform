-- CreateTable
CREATE TABLE "player_notes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "player_id" UUID NOT NULL,
    "admin_id" UUID,
    "text" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "player_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "player_notes_player_id_created_at_idx" ON "player_notes"("player_id", "created_at");

-- CreateIndex
CREATE INDEX "runs_created_at_idx" ON "runs"("created_at");

-- AddForeignKey
ALTER TABLE "player_notes" ADD CONSTRAINT "player_notes_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_notes" ADD CONSTRAINT "player_notes_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
