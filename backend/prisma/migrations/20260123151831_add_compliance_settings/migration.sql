-- CreateTable
CREATE TABLE "compliance_settings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "chorusApiUrl" TEXT,
    "chorusClientId" TEXT,
    "chorusClientSecret" TEXT,
    "chorusTechnicalAccountId" TEXT,
    "pdpApiUrl" TEXT,
    "pdpApiKey" TEXT,
    "pdpClientId" TEXT,
    "pdpProvider" TEXT,
    "peppolAccessPointUrl" TEXT,
    "peppolSenderId" TEXT,
    "peppolCertificatePem" TEXT,
    "peppolPrivateKeyPem" TEXT,
    "peppolEnvironment" TEXT DEFAULT 'test',
    "sdiApiUrl" TEXT,
    "sdiCertificatePem" TEXT,
    "sdiPrivateKeyPem" TEXT,
    "sdiCertificatePassword" TEXT,
    "verifactuApiUrl" TEXT,
    "verifactuCertificatePem" TEXT,
    "verifactuPrivateKeyPem" TEXT,
    "verifactuNif" TEXT,
    "saftSoftwareCertificateNumber" TEXT,
    "saftHashValidationKey" TEXT,
    "defaultTransmissionPlatform" TEXT,
    "enableAutoTransmission" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "compliance_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "compliance_settings_companyId_key" ON "compliance_settings"("companyId");

-- CreateIndex
CREATE INDEX "compliance_settings_companyId_idx" ON "compliance_settings"("companyId");

-- AddForeignKey
ALTER TABLE "compliance_settings" ADD CONSTRAINT "compliance_settings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
