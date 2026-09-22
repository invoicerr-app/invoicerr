-- Portugal's ATCUD (Portaria n.º 195/2020) — see schema.prisma's own comments on
-- `DocumentInstance.atcud` and `CompanyAtcudSeries` for the full rationale.

-- AlterTable
ALTER TABLE "DocumentInstance" ADD COLUMN     "atcud" TEXT;

-- CreateTable
CREATE TABLE "CompanyAtcudSeries" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "validationCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyAtcudSeries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompanyAtcudSeries_companyId_idx" ON "CompanyAtcudSeries"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyAtcudSeries_companyId_typeId_seriesId_key" ON "CompanyAtcudSeries"("companyId", "typeId", "seriesId");

-- AddForeignKey
ALTER TABLE "CompanyAtcudSeries" ADD CONSTRAINT "CompanyAtcudSeries_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
