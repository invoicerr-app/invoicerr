-- CreateTable
CREATE TABLE "DocumentCountryActionRule" (
    "id" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "allowed" BOOLEAN NOT NULL,
    "provenanceKind" TEXT NOT NULL,
    "sourceText" TEXT,
    "sourceCheckedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentCountryActionRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocumentCountryActionRule_countryCode_idx" ON "DocumentCountryActionRule"("countryCode");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentCountryActionRule_countryCode_typeId_actionId_key" ON "DocumentCountryActionRule"("countryCode", "typeId", "actionId");
