/*
  Issue #415 - "several named contacts per client". A client used to carry exactly one contact as
  four flat columns (`contactFirstname`/`contactLastname`/`contactEmail`/`contactPhone`). This
  migration:
    1. creates the new `ClientContact` table;
    2. copies each existing client's four columns into ONE primary `ClientContact` row, but ONLY when
       at least one of the four is non-null - a client with all four null gets NO contact row (an
       empty row nobody ever filled in is not "a contact", and zero contacts is a valid shape the
       application itself allows). Values are copied
       byte-identical: no `TRIM()`, no `LOWER()`, empty strings stay empty strings - "unchanged"
       means unchanged;
    3. THEN drops the four legacy columns, since after step 2 `ClientContact` is the only source of
       truth;
    4. adds a partial unique index Prisma's schema language cannot express (`@@unique` has no `WHERE`
       clause): at most one `isPrimary = true` row per client. The application layer
       (`clients/contacts/client-contacts.ts#writeClientContacts`) already never leaves two primaries
       momentarily set inside the same transaction, but this index is the DB-level backstop against a
       future write path that forgets to.
*/

-- CreateTable
CREATE TABLE "ClientContact" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "role" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientContact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientContact_clientId_idx" ON "ClientContact"("clientId");

-- AddForeignKey
ALTER TABLE "ClientContact" ADD CONSTRAINT "ClientContact_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: one primary ClientContact per existing Client that has at least one non-null legacy
-- field. `updatedAt` is set to `now()` (there is no legacy "when was the contact last touched" value
-- to carry over - the row itself is new). The table's `id` is a Prisma `cuid()` default applied
-- application-side, never at the DB level, so this one-off backfill mints its own: a `ctc_`-prefixed
-- `gen_random_uuid()` (built into PostgreSQL 13+), unique and non-null, which is all the column asks.
INSERT INTO "ClientContact" ("id", "clientId", "firstName", "lastName", "email", "phone", "isPrimary", "position", "createdAt", "updatedAt")
SELECT
  'ctc_' || replace(gen_random_uuid()::text, '-', ''),
  "id",
  "contactFirstname",
  "contactLastname",
  "contactEmail",
  "contactPhone",
  true,
  0,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Client"
WHERE "contactFirstname" IS NOT NULL
   OR "contactLastname" IS NOT NULL
   OR "contactEmail" IS NOT NULL
   OR "contactPhone" IS NOT NULL;

-- AlterTable: drop the legacy columns now that ClientContact is the only source of truth.
ALTER TABLE "Client" DROP COLUMN "contactEmail",
DROP COLUMN "contactFirstname",
DROP COLUMN "contactLastname",
DROP COLUMN "contactPhone";

-- CreateIndex: at most one primary contact per client (see this file's own header, point 4).
CREATE UNIQUE INDEX "ClientContact_clientId_primary_key" ON "ClientContact"("clientId") WHERE "isPrimary";
