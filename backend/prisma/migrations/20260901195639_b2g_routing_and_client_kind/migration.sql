-- CreateEnum
CREATE TYPE "ClientKind" AS ENUM ('BUSINESS', 'GOVERNMENT');

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "kind" "ClientKind" NOT NULL DEFAULT 'BUSINESS';

-- CreateTable
CREATE TABLE "B2gRoutingRule" (
    "id" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "transportId" TEXT NOT NULL,
    "formatSyntax" TEXT NOT NULL,
    "requiredClientIdentifiers" JSONB NOT NULL DEFAULT '[]',
    "requiredDocumentFields" JSONB NOT NULL DEFAULT '[]',
    "provenanceKind" TEXT NOT NULL,
    "sourceText" TEXT,
    "sourceCheckedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "B2gRoutingRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "B2gRoutingRule_countryCode_key" ON "B2gRoutingRule"("countryCode");

-- CreateIndex
CREATE INDEX "B2gRoutingRule_countryCode_idx" ON "B2gRoutingRule"("countryCode");
