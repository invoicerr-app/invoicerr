/*
  Migrate existing mail templates from the deprecated RECEIPT type to PAYMENT.

  Run as a separate migration because the PAYMENT enum value was added in the
  previous migration and Postgres forbids using a freshly added enum value in
  the same transaction that introduced it.
*/

UPDATE "MailTemplate" SET "type" = 'PAYMENT' WHERE "type" = 'RECEIPT';
