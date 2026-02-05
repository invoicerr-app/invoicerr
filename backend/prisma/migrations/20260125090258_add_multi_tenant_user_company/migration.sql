-- CreateEnum
CREATE TYPE "UserCompanyRole" AS ENUM ('SYSTEM_ADMIN', 'OWNER', 'ADMIN', 'ACCOUNTANT');

-- AlterTable
ALTER TABLE "invitation_code" ADD COLUMN     "companyId" TEXT,
ADD COLUMN     "role" "UserCompanyRole" NOT NULL DEFAULT 'ACCOUNTANT';

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "isSystemAdmin" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "user_company" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "role" "UserCompanyRole" NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "user_company_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_company_userId_idx" ON "user_company"("userId");

-- CreateIndex
CREATE INDEX "user_company_companyId_idx" ON "user_company"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "user_company_userId_companyId_key" ON "user_company"("userId", "companyId");

-- CreateIndex
CREATE INDEX "invitation_code_companyId_idx" ON "invitation_code"("companyId");

-- AddForeignKey
ALTER TABLE "invitation_code" ADD CONSTRAINT "invitation_code_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_company" ADD CONSTRAINT "user_company_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_company" ADD CONSTRAINT "user_company_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
