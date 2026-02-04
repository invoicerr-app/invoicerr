/*
  Adding addressLine2 and state fields to Company and Client tables for extended address support.
  
  - Added addressLine2 to Company table (optional, for apartment/suite/building numbers)
  - Added state to Company table (optional, for US states and other regions)
  - Added addressLine2 to Client table (optional, for apartment/suite/building numbers)
  - Added state to Client table (optional, for US states and other regions)

*/
-- AlterTable
ALTER TABLE "public"."Company" ADD COLUMN "addressLine2" TEXT,
ADD COLUMN "state" TEXT;

-- AlterTable
ALTER TABLE "public"."Client" ADD COLUMN "addressLine2" TEXT,
ADD COLUMN "state" TEXT;
