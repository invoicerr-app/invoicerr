-- CreateTable
CREATE TABLE "CompanySsoProvider" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "discoveryUrl" TEXT,
    "authorizationUrl" TEXT,
    "tokenUrl" TEXT,
    "userInfoUrl" TEXT,
    "scopes" TEXT[] DEFAULT ARRAY['openid', 'profile', 'email']::TEXT[],
    "credentials" TEXT NOT NULL,
    "emailDomains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "domainsVerifiedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanySsoProvider_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompanySsoProvider_companyId_key" ON "CompanySsoProvider"("companyId");

-- AddForeignKey
ALTER TABLE "CompanySsoProvider" ADD CONSTRAINT "CompanySsoProvider_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
