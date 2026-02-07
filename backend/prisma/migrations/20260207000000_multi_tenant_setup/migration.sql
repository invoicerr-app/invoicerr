-- ============================================================
-- Multi-Tenant Setup Migration
-- Date: 2026-02-07
-- Description: Creates UserRole enum, UserCompany junction table,
--              and links invitations to companies
-- ============================================================

-- Create UserRole enum
CREATE TYPE "UserRole" AS ENUM ('SUPERADMIN', 'ADMIN', 'USER');

-- Create UserCompany junction table for many-to-many relationship
CREATE TABLE "user_company" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_company_pkey" PRIMARY KEY ("id")
);

-- Create unique index to prevent duplicate user-company assignments
CREATE UNIQUE INDEX "user_company_userId_companyId_key" ON "user_company"("userId", "companyId");

-- Create indexes for efficient querying
CREATE INDEX "user_company_userId_idx" ON "user_company"("userId");
CREATE INDEX "user_company_companyId_idx" ON "user_company"("companyId");

-- Add foreign key constraints
ALTER TABLE "user_company" ADD CONSTRAINT "user_company_userId_fkey" 
    FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_company" ADD CONSTRAINT "user_company_companyId_fkey" 
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Add companyId to InvitationCode table
ALTER TABLE "invitation_code" ADD COLUMN "companyId" TEXT;

-- Add foreign key for company relationship on invitations
ALTER TABLE "invitation_code" ADD CONSTRAINT "invitation_code_companyId_fkey" 
    FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Create index on companyId for invitations
CREATE INDEX "invitation_code_companyId_idx" ON "invitation_code"("companyId");

-- ============================================================
-- DATA MIGRATION
-- ============================================================

-- Migration: Set first user (oldest created) as SUPERADMIN of all existing companies
-- This ensures backward compatibility - the first user retains full access
INSERT INTO "user_company" ("id", "userId", "companyId", "role", "updatedAt")
SELECT 
    gen_random_uuid()::text,
    first_user.id as "userId",
    c.id as "companyId",
    'SUPERADMIN'::"UserRole" as role,
    NOW() as "updatedAt"
FROM "Company" c
CROSS JOIN (
    SELECT id FROM "user" ORDER BY "createdAt" ASC LIMIT 1
) first_user
WHERE EXISTS (SELECT 1 FROM "user" LIMIT 1);  -- Only run if users exist

-- Migration: Set all other users as USER of their matched companies
-- This uses email matching as a heuristic for initial company assignment
INSERT INTO "user_company" ("id", "userId", "companyId", "role", "updatedAt")
SELECT 
    gen_random_uuid()::text,
    u.id as "userId",
    c.id as "companyId",
    'USER'::"UserRole" as role,
    NOW() as "updatedAt"
FROM "user" u
JOIN "Company" c ON LOWER(c.email) = LOWER(u.email)
WHERE u.id != (SELECT id FROM "user" ORDER BY "createdAt" ASC LIMIT 1)
ON CONFLICT ("userId", "companyId") DO NOTHING;

-- Update existing invitation codes to link to the creating user's company
-- This assumes invitations created by a user should be for that user's primary company
UPDATE "invitation_code" ic
SET "companyId" = uc."companyId"
FROM "user_company" uc
WHERE ic."createdById" = uc."userId"
AND uc.role = 'SUPERADMIN'  -- Prefer SUPERADMIN company assignments
AND ic."companyId" IS NULL;

-- Create a comment explaining the migration
COMMENT ON TABLE "user_company" IS 'Junction table linking users to companies with role-based access';
COMMENT ON COLUMN "user_company"."role" IS 'User role: SUPERADMIN (full access), ADMIN (company admin), USER (regular user)';
COMMENT ON COLUMN "invitation_code"."companyId" IS 'Company this invitation grants access to';
