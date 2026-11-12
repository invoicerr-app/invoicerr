-- AlterTable
ALTER TABLE "DocumentInstance" ADD COLUMN "conformityRejectedAt" TIMESTAMP(3),
ADD COLUMN "conformityRejectedReason" TEXT;
