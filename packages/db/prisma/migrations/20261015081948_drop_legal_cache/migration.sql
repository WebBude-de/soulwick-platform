/*
  Warnings:

  - You are about to drop the `erecht24_push_clients` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `legal_documents` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE "erecht24_push_clients";

-- DropTable
DROP TABLE "legal_documents";

-- DropEnum
DROP TYPE "legal_document_type";
