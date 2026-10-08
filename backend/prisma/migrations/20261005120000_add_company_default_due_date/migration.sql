-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "invoiceDueDays" INTEGER,
ADD COLUMN     "invoiceDueMode" TEXT,
ADD COLUMN     "quoteDueDays" INTEGER,
ADD COLUMN     "quoteDueMode" TEXT;
