-- AlterTable
ALTER TABLE "DocumentCountryActionRule" ADD COLUMN     "statuses" TEXT[] DEFAULT ARRAY[]::TEXT[];
