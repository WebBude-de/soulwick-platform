-- AlterEnum
ALTER TYPE "web_login_status" ADD VALUE 'awaiting_confirm';

-- AlterTable
ALTER TABLE "web_login_requests" ADD COLUMN     "browser_secret_hash" TEXT,
ADD COLUMN     "confirm_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "user_code_hash" TEXT;
