-- Numbering overhaul (PART II.3)
-- - New NumberSeries table for gapless per-series counters
-- - Invoice/Quote/Payment.number → nullable (no autoincrement)
-- - Add issuedAt to Invoice and Quote
-- - Data-preserving backfill: preserve existing numbers, seed NumberSeries

-- 1. Create NumberSeries table
CREATE TABLE "NumberSeries" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "counter" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NumberSeries_pkey" PRIMARY KEY ("id")
);

-- 2. Add indexes and constraints
CREATE UNIQUE INDEX "NumberSeries_companyId_docType_scopeKey_key" ON "NumberSeries"("companyId", "docType", "scopeKey");
ALTER TABLE "NumberSeries" ADD CONSTRAINT "NumberSeries_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. Add issuedAt to Invoice and Quote
ALTER TABLE "Invoice" ADD COLUMN "issuedAt" TIMESTAMP(3);
ALTER TABLE "Quote" ADD COLUMN "issuedAt" TIMESTAMP(3);

-- 4. Backfill: set issuedAt = createdAt for all existing rows
UPDATE "Invoice" SET "issuedAt" = "createdAt" WHERE "issuedAt" IS NULL;
UPDATE "Quote" SET "issuedAt" = "createdAt" WHERE "issuedAt" IS NULL;

-- 5. Change Invoice.number from SERIAL (autoincrement NOT NULL) to nullable Int
ALTER TABLE "Invoice" ALTER COLUMN "number" DROP DEFAULT;
ALTER TABLE "Invoice" ALTER COLUMN "number" DROP NOT NULL;

-- 6. Change Quote.number from SERIAL (autoincrement NOT NULL) to nullable Int
ALTER TABLE "Quote" ALTER COLUMN "number" DROP DEFAULT;
ALTER TABLE "Quote" ALTER COLUMN "number" DROP NOT NULL;

-- 7. Change Payment.number from SERIAL (autoincrement NOT NULL) to nullable Int
ALTER TABLE "Payment" ALTER COLUMN "number" DROP DEFAULT;
ALTER TABLE "Payment" ALTER COLUMN "number" DROP NOT NULL;

-- 8. Seed NumberSeries for each company/docType with the max existing counter value
--    ScopeKey is the ISO year from issuedAt (or createdAt as fallback)
INSERT INTO "NumberSeries" ("id", "companyId", "docType", "scopeKey", "counter", "createdAt", "updatedAt")
SELECT
    gen_random_uuid()::text,
    "companyId",
    'invoice',
    EXTRACT(YEAR FROM COALESCE("issuedAt", "createdAt"))::text,
    MAX("number"),
    now(),
    now()
FROM "Invoice"
WHERE "number" IS NOT NULL
GROUP BY "companyId", EXTRACT(YEAR FROM COALESCE("issuedAt", "createdAt"))::text;

INSERT INTO "NumberSeries" ("id", "companyId", "docType", "scopeKey", "counter", "createdAt", "updatedAt")
SELECT
    gen_random_uuid()::text,
    "companyId",
    'quote',
    EXTRACT(YEAR FROM COALESCE("issuedAt", "createdAt"))::text,
    MAX("number"),
    now(),
    now()
FROM "Quote"
WHERE "number" IS NOT NULL
GROUP BY "companyId", EXTRACT(YEAR FROM COALESCE("issuedAt", "createdAt"))::text;

INSERT INTO "NumberSeries" ("id", "companyId", "docType", "scopeKey", "counter", "createdAt", "updatedAt")
SELECT
    gen_random_uuid()::text,
    "Invoice"."companyId",
    'payment',
    EXTRACT(YEAR FROM "Payment"."createdAt")::text,
    MAX("Payment"."number"),
    now(),
    now()
FROM "Payment"
INNER JOIN "Invoice" ON "Payment"."invoiceId" = "Invoice"."id"
WHERE "Payment"."number" IS NOT NULL
GROUP BY "Invoice"."companyId", EXTRACT(YEAR FROM "Payment"."createdAt")::text;
