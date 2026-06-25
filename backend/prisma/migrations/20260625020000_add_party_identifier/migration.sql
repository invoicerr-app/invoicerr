-- CreateTable
CREATE TABLE "PartyIdentifier" (
    "id" TEXT NOT NULL,
    "scheme" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "companyId" TEXT,
    "clientId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartyIdentifier_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PartyIdentifier_companyId_scheme_key" ON "PartyIdentifier"("companyId", "scheme");

-- CreateIndex
CREATE UNIQUE INDEX "PartyIdentifier_clientId_scheme_key" ON "PartyIdentifier"("clientId", "scheme");

-- AddForeignKey
ALTER TABLE "PartyIdentifier" ADD CONSTRAINT "PartyIdentifier_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartyIdentifier" ADD CONSTRAINT "PartyIdentifier_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve existing identifiers into PartyIdentifier BEFORE the columns are dropped.
INSERT INTO "PartyIdentifier" ("id","scheme","value","companyId","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'LEGAL_ID', "legalId", "id", now(), now()
FROM "Company" WHERE "legalId" IS NOT NULL AND "legalId" <> '';

INSERT INTO "PartyIdentifier" ("id","scheme","value","companyId","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'VAT', "VAT", "id", now(), now()
FROM "Company" WHERE "VAT" IS NOT NULL AND "VAT" <> '';

INSERT INTO "PartyIdentifier" ("id","scheme","value","clientId","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'LEGAL_ID', "legalId", "id", now(), now()
FROM "Client" WHERE "legalId" IS NOT NULL AND "legalId" <> '';

INSERT INTO "PartyIdentifier" ("id","scheme","value","clientId","createdAt","updatedAt")
SELECT gen_random_uuid()::text, 'VAT', "VAT", "id", now(), now()
FROM "Client" WHERE "VAT" IS NOT NULL AND "VAT" <> '';

-- DropColumn from Company
ALTER TABLE "Company" DROP COLUMN "legalId";
ALTER TABLE "Company" DROP COLUMN "VAT";

-- DropColumn from Client
ALTER TABLE "Client" DROP COLUMN "legalId";
ALTER TABLE "Client" DROP COLUMN "VAT";
