-- CreateEnum
CREATE TYPE "bug_report_kind" AS ENUM ('bug', 'idea');

-- AlterTable
ALTER TABLE "bug_reports" ADD COLUMN     "kind" "bug_report_kind" NOT NULL DEFAULT 'bug';
