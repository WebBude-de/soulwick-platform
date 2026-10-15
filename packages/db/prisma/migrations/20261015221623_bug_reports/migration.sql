-- CreateEnum
CREATE TYPE "bug_report_status" AS ENUM ('new', 'seen', 'done', 'wont_fix');

-- CreateTable
CREATE TABLE "bug_reports" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "player_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "bug_report_status" NOT NULL DEFAULT 'new',
    "note" TEXT NOT NULL DEFAULT '',
    "categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "marks" JSONB NOT NULL DEFAULT '[]',
    "strokes" JSONB NOT NULL DEFAULT '[]',
    "context" JSONB NOT NULL DEFAULT '{}',
    "game_version" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "image_mime" TEXT NOT NULL,
    "image" BYTEA NOT NULL,
    "handled_by" UUID,
    "handled_at" TIMESTAMPTZ(6),

    CONSTRAINT "bug_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bug_reports_status_created_at_idx" ON "bug_reports"("status", "created_at");

-- CreateIndex
CREATE INDEX "bug_reports_created_at_idx" ON "bug_reports"("created_at");

-- CreateIndex
CREATE INDEX "bug_reports_player_id_idx" ON "bug_reports"("player_id");

-- AddForeignKey
ALTER TABLE "bug_reports" ADD CONSTRAINT "bug_reports_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bug_reports" ADD CONSTRAINT "bug_reports_handled_by_fkey" FOREIGN KEY ("handled_by") REFERENCES "auth_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
