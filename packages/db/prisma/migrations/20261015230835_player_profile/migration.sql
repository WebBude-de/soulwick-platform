-- AlterTable
ALTER TABLE "players" ADD COLUMN     "appearance" JSONB;

-- CreateTable
CREATE TABLE "player_name_changes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "player_id" UUID NOT NULL,
    "old_name" TEXT NOT NULL,
    "new_name" TEXT NOT NULL,
    "changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "admin_id" UUID,

    CONSTRAINT "player_name_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "player_name_changes_player_id_changed_at_idx" ON "player_name_changes"("player_id", "changed_at");

-- CreateIndex
CREATE INDEX "player_name_changes_changed_at_idx" ON "player_name_changes"("changed_at");

-- AddForeignKey
ALTER TABLE "player_name_changes" ADD CONSTRAINT "player_name_changes_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_name_changes" ADD CONSTRAINT "player_name_changes_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "auth_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
