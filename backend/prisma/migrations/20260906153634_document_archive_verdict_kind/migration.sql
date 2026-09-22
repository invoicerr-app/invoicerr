-- CreateEnum
CREATE TYPE "DocumentArchiveKind" AS ENUM ('DELIVERY', 'VERDICT');

-- AlterTable
ALTER TABLE "DocumentArchive" ADD COLUMN     "kind" "DocumentArchiveKind" NOT NULL DEFAULT 'DELIVERY',
ADD COLUMN     "parentArchiveId" TEXT,
ADD COLUMN     "verdictKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "DocumentArchive_verdictKey_key" ON "DocumentArchive"("verdictKey");

-- AddForeignKey
ALTER TABLE "DocumentArchive" ADD CONSTRAINT "DocumentArchive_parentArchiveId_fkey" FOREIGN KEY ("parentArchiveId") REFERENCES "DocumentArchive"("id") ON DELETE SET NULL ON UPDATE CASCADE;
