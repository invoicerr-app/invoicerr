-- Tighten the company-scoping columns to NOT NULL now that the previous
-- migration has backfilled every existing row. Must run as its own
-- migration, strictly after the backfill: this table can otherwise contain
-- rows the ALTER would reject on an instance whose previous migration
-- hadn't applied yet at the time this one starts.
ALTER TABLE "Client" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "api_key" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "invitation_code" ALTER COLUMN "companyId" SET NOT NULL;
