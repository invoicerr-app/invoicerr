-- Data backfill for existing (pre-multi-company) single-tenant instances.
--
-- Every self-hosted instance so far has had exactly one Company row and no
-- notion of membership. This migration makes that implicit assumption
-- explicit: the earliest-created company becomes the canonical tenant,
-- every existing user is attached to it as OWNER (today, every user
-- implicitly has full access), and every pre-existing api key / invitation
-- code / client is attached to that same company.
--
-- No-op on a brand-new install with no Company row yet: the app's
-- company-creation flow inserts its own UserCompany(OWNER) row at creation
-- time, so there is nothing to backfill for that case.
DO $$
DECLARE
  canonical_company_id TEXT;
BEGIN
  SELECT "id" INTO canonical_company_id FROM "Company" ORDER BY "createdAt" ASC, "id" ASC LIMIT 1;

  IF canonical_company_id IS NOT NULL THEN
    INSERT INTO "user_company" ("id", "userId", "companyId", "role", "createdAt")
    SELECT gen_random_uuid()::text, u."id", canonical_company_id, 'OWNER', now()
    FROM "user" u
    ON CONFLICT ("userId", "companyId") DO NOTHING;

    UPDATE "api_key" SET "companyId" = canonical_company_id WHERE "companyId" IS NULL;
    UPDATE "invitation_code" SET "companyId" = canonical_company_id WHERE "companyId" IS NULL;
    UPDATE "Client" SET "companyId" = canonical_company_id WHERE "companyId" IS NULL;
  END IF;
END $$;
