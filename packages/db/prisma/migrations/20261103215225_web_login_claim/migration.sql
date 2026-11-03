-- AlterTable
ALTER TABLE "web_login_requests" ADD COLUMN     "browser_claimed_at" TIMESTAMPTZ(6),
ADD COLUMN     "browser_token_hash" TEXT;
