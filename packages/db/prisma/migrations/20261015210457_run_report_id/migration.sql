-- AlterTable
ALTER TABLE "runs" ADD COLUMN     "guild_payout" INTEGER,
ADD COLUMN     "report_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "runs_report_id_unique" ON "runs"("report_id");

