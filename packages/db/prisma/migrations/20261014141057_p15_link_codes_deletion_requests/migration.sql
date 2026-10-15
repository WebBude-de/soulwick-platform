-- CreateEnum
CREATE TYPE "deletion_request_status" AS ENUM ('open', 'done', 'rejected');

-- CreateTable
CREATE TABLE "link_codes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "player_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "link_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_deletion_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "player_name" TEXT NOT NULL,
    "player_id" UUID,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "contact" TEXT,
    "message" TEXT,
    "status" "deletion_request_status" NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_by" UUID,
    "resolution_note" TEXT,

    CONSTRAINT "account_deletion_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "link_codes_player_id_unique" ON "link_codes"("player_id");

-- CreateIndex
CREATE UNIQUE INDEX "link_codes_code_hash_unique" ON "link_codes"("code_hash");

-- CreateIndex
CREATE INDEX "account_deletion_requests_status_created_at_idx" ON "account_deletion_requests"("status", "created_at");

-- AddForeignKey
ALTER TABLE "link_codes" ADD CONSTRAINT "link_codes_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_deletion_requests" ADD CONSTRAINT "account_deletion_requests_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "players"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_deletion_requests" ADD CONSTRAINT "account_deletion_requests_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
