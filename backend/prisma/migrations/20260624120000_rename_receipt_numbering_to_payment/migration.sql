/*
  Renaming the company receipt numbering fields to payment numbering as part of
  the receipt -> payment refactor.

  - Renamed "receiptStartingNumber" to "paymentStartingNumber" on the Company table
  - Renamed "receiptNumberFormat" to "paymentNumberFormat" on the Company table
*/
-- AlterTable
ALTER TABLE "public"."Company" RENAME COLUMN "receiptStartingNumber" TO "paymentStartingNumber";
ALTER TABLE "public"."Company" RENAME COLUMN "receiptNumberFormat" TO "paymentNumberFormat";
ALTER TABLE "public"."Company" ALTER COLUMN "paymentNumberFormat" SET DEFAULT 'PAY-{year}-{number:4}';
