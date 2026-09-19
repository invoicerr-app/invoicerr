-- DropEnum
-- "PaymentMethodType" — dead since the pre-refonte "PaymentMethod" table itself was dropped
-- (20260829233000_suppression_documents_legaux: `DROP TABLE IF EXISTS "PaymentMethod" CASCADE`),
-- which left this Postgres enum TYPE behind with nothing referencing it any more (zero columns,
-- zero backend/src usages). The new, typed payment-methods feature (payment-methods/) replaces it
-- with a registry of descriptors, never a closed DB enum — see that module's own header.
DROP TYPE "public"."PaymentMethodType";

-- AlterTable
-- BT-86-adjacent (Payment service provider identifier) — pairs with the pre-existing "iban" column;
-- see Company.bic's own schema.prisma comment for why this is written only through the new
-- payment-methods module, never through EditCompanyDto.
ALTER TABLE "Company" ADD COLUMN     "bic" TEXT;

-- CreateTable
CREATE TABLE "CompanyPaymentMethodConfig" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "methodId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyPaymentMethodConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompanyPaymentMethodConfig_companyId_idx" ON "CompanyPaymentMethodConfig"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyPaymentMethodConfig_companyId_methodId_key" ON "CompanyPaymentMethodConfig"("companyId", "methodId");

-- AddForeignKey
ALTER TABLE "CompanyPaymentMethodConfig" ADD CONSTRAINT "CompanyPaymentMethodConfig_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
