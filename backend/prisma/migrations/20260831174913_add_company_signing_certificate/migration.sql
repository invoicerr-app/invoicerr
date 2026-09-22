-- CreateTable
CREATE TABLE "CompanySigningCertificate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "applicability" TEXT NOT NULL DEFAULT '*',
    "environment" "ChannelEnvironment" NOT NULL DEFAULT 'TEST',
    "encryptedPfx" TEXT NOT NULL,
    "encryptedPass" TEXT NOT NULL,
    "notBefore" TIMESTAMP(3) NOT NULL,
    "notAfter" TIMESTAMP(3) NOT NULL,
    "serial" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanySigningCertificate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompanySigningCertificate_companyId_idx" ON "CompanySigningCertificate"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanySigningCertificate_companyId_applicability_environme_key" ON "CompanySigningCertificate"("companyId", "applicability", "environment");

-- AddForeignKey
ALTER TABLE "CompanySigningCertificate" ADD CONSTRAINT "CompanySigningCertificate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
