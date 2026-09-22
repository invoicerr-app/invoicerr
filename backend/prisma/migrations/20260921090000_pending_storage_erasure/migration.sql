-- CreateEnum
CREATE TYPE "PendingStorageErasureKind" AS ENUM ('ARCHIVE', 'INBOUND_PREFIX');

-- CreateTable
CREATE TABLE "PendingStorageErasure" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" "PendingStorageErasureKind" NOT NULL,
    "target" TEXT NOT NULL,
    "documentId" TEXT,
    "retentionUntil" TIMESTAMP(3),
    "retentionBasis" TEXT,
    "journaledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "erasedAt" TIMESTAMP(3),
    "lastError" TEXT,

    CONSTRAINT "PendingStorageErasure_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PendingStorageErasure_erasedAt_idx" ON "PendingStorageErasure"("erasedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PendingStorageErasure_companyId_kind_target_key" ON "PendingStorageErasure"("companyId", "kind", "target");
