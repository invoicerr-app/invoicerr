-- CreateEnum
CREATE TYPE "CompanyOwnershipTransferStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'CANCELED');

-- CreateTable
CREATE TABLE "company_ownership_transfer" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "status" "CompanyOwnershipTransferStatus" NOT NULL DEFAULT 'PENDING',
    "fromUserId" TEXT NOT NULL,
    "toEmail" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_ownership_transfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "company_ownership_transfer_companyId_idx" ON "company_ownership_transfer"("companyId");

-- CreateIndex
CREATE INDEX "company_ownership_transfer_toUserId_idx" ON "company_ownership_transfer"("toUserId");

-- CreateIndex
--
-- "At most one PENDING transfer per company" — a partial unique index, not expressible in the Prisma
-- schema DSL (no `@@unique(..., where: ...)`), hand-appended the same way
-- `20260912160000_sso_domain_verification` already hand-appends SQL the generator alone cannot
-- produce. Unlike that migration's own deliberately-NOT-globally-unique domain column, this one IS a
-- real database-level guarantee: `companyId` is never secret to the OWNER initiating a transfer (this
-- is their own company), so there is no enumeration concern in enforcing it here rather than only in
-- application code — a concurrent double-submit fails outright on the unique-violation instead of
-- racing into two PENDING rows for the same company.
CREATE UNIQUE INDEX "company_ownership_transfer_one_pending_per_company"
ON "company_ownership_transfer" ("companyId")
WHERE "status" = 'PENDING';

-- AddForeignKey
ALTER TABLE "company_ownership_transfer" ADD CONSTRAINT "company_ownership_transfer_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_ownership_transfer" ADD CONSTRAINT "company_ownership_transfer_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_ownership_transfer" ADD CONSTRAINT "company_ownership_transfer_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
