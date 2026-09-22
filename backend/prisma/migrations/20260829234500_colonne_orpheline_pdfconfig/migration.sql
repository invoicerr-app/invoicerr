-- The previous migration dropped the `PDFConfig` table but left the column that referenced it:
-- CASCADE removes the foreign-key constraint, not the column itself. That column stayed NOT NULL,
-- so creating a company failed outright -- found by replaying the surviving e2e tests.
ALTER TABLE "Company" DROP COLUMN IF EXISTS "pDFConfigId";
