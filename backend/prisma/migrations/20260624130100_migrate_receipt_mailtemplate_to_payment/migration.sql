/*
  Migrate existing mail templates from the deprecated RECEIPT type to PAYMENT.

  Run as a separate migration because the PAYMENT enum value was added in the
  previous migration and Postgres forbids using a freshly added enum value in
  the same transaction that introduced it.
*/

-- Drop stale RECEIPT rows where a PAYMENT template already exists for the
-- same company (app code defaulting to PAYMENT while this rename had never
-- actually run yet would otherwise hit the (companyId, type) unique
-- constraint below).
DELETE FROM "MailTemplate" r
WHERE r."type" = 'RECEIPT'
  AND EXISTS (
    SELECT 1 FROM "MailTemplate" p
    WHERE p."companyId" = r."companyId" AND p."type" = 'PAYMENT'
  );

UPDATE "MailTemplate" SET "type" = 'PAYMENT' WHERE "type" = 'RECEIPT';
