-- CreateEnum
CREATE TYPE "CompanyRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- AlterTable: Company gains createdAt, used as the canonical-tenant
-- tiebreaker by the backfill migration that follows.
ALTER TABLE "Company" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable: new company-scoping columns, added nullable so this applies
-- cleanly to non-empty tables. Tightened to NOT NULL in
-- 20260705120200_enforce_multi_company_constraints, after the backfill
-- migration in between has populated them.
ALTER TABLE "Client" ADD COLUMN     "companyId" TEXT;
ALTER TABLE "api_key" ADD COLUMN     "companyId" TEXT;
ALTER TABLE "invitation_code" ADD COLUMN     "companyId" TEXT,
ADD COLUMN     "role" "CompanyRole" NOT NULL DEFAULT 'MEMBER';
ALTER TABLE "session" ADD COLUMN     "activeCompanyId" TEXT;

-- CreateTable
CREATE TABLE "user_company" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "role" "CompanyRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_company_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_company_userId_idx" ON "user_company"("userId");

-- CreateIndex
CREATE INDEX "user_company_companyId_idx" ON "user_company"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "user_company_userId_companyId_key" ON "user_company"("userId", "companyId");

-- CreateIndex
CREATE INDEX "Client_companyId_idx" ON "Client"("companyId");

-- CreateIndex
CREATE INDEX "api_key_companyId_idx" ON "api_key"("companyId");

-- CreateIndex
CREATE INDEX "invitation_code_companyId_idx" ON "invitation_code"("companyId");

-- AddForeignKey
ALTER TABLE "user_company" ADD CONSTRAINT "user_company_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_company" ADD CONSTRAINT "user_company_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation_code" ADD CONSTRAINT "invitation_code_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
