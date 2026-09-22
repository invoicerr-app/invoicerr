-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "numberFormats" JSONB;

-- AlterTable
ALTER TABLE "DocumentInstance" ADD COLUMN     "displayNumber" TEXT,
ADD COLUMN     "number" INTEGER;

-- CreateTable
CREATE TABLE "DocumentNumberSequence" (
    "companyId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "nextNumber" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "DocumentNumberSequence_pkey" PRIMARY KEY ("companyId","typeId")
);

-- AddForeignKey
ALTER TABLE "DocumentNumberSequence" ADD CONSTRAINT "DocumentNumberSequence_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
