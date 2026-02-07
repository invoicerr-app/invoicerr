-- ============================================================
-- DOWN MIGRATION - Multi-Tenant Setup Rollback
-- Date: 2026-02-07
-- WARNING: This will remove all role-based access data!
-- ============================================================

-- Remove companyId from invitations
ALTER TABLE "invitation_code" DROP COLUMN IF EXISTS "companyId";

-- Drop indexes on user_company
DROP INDEX IF EXISTS "user_company_companyId_idx";
DROP INDEX IF EXISTS "user_company_userId_idx";
DROP INDEX IF EXISTS "user_company_userId_companyId_key";

-- Drop foreign keys on user_company
ALTER TABLE "user_company" DROP CONSTRAINT IF EXISTS "user_company_companyId_fkey";
ALTER TABLE "user_company" DROP CONSTRAINT IF EXISTS "user_company_userId_fkey";

-- Drop the user_company table
DROP TABLE IF EXISTS "user_company";

-- Drop the UserRole enum
DROP TYPE IF EXISTS "UserRole";
