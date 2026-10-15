-- DropIndex
DROP INDEX "guild_members_player_id_unique";

-- CreateIndex
CREATE INDEX "guild_members_player_id_idx" ON "guild_members"("player_id");
