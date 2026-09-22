-- CreateEnum
CREATE TYPE "CompanySubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'BLOCKED', 'ZIPPED', 'DELETED');

-- CreateEnum
CREATE TYPE "CompanySubscriptionInterval" AS ENUM ('MONTH', 'YEAR');

-- CreateTable
CREATE TABLE "company_subscription" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "status" "CompanySubscriptionStatus" NOT NULL DEFAULT 'TRIAL',
    "trialStartedAt" TIMESTAMP(3) NOT NULL,
    "trialEndsAt" TIMESTAMP(3) NOT NULL,
    "blockedAt" TIMESTAMP(3),
    "zipSentAt" TIMESTAMP(3),
    "deletionDueAt" TIMESTAMP(3),
    "polarCustomerId" TEXT,
    "polarSubscriptionId" TEXT,
    "seats" INTEGER NOT NULL DEFAULT 1,
    "interval" "CompanySubscriptionInterval",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_subscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "company_subscription_companyId_key" ON "company_subscription"("companyId");

-- CreateIndex
CREATE INDEX "company_subscription_status_idx" ON "company_subscription"("status");

-- AddForeignKey
ALTER TABLE "company_subscription" ADD CONSTRAINT "company_subscription_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
