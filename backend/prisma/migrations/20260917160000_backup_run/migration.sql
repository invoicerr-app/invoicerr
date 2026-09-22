-- Adds the `BackupRun` table — see schema.prisma's own header on this model for the "why" (one row
-- per periodic instance-file-backup sweep, updated in place as the run progresses, so
-- GET /api/backup/status always has something to read even for a run still in flight).
-- CreateEnum
CREATE TYPE "BackupRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "BackupRun" (
    "id" TEXT NOT NULL,
    "status" "BackupRunStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "filesScanned" INTEGER NOT NULL DEFAULT 0,
    "filesUploaded" INTEGER NOT NULL DEFAULT 0,
    "filesSkipped" INTEGER NOT NULL DEFAULT 0,
    "filesFailed" INTEGER NOT NULL DEFAULT 0,
    "bytesUploaded" BIGINT NOT NULL DEFAULT 0,
    "errors" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "BackupRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BackupRun_startedAt_idx" ON "BackupRun"("startedAt");
