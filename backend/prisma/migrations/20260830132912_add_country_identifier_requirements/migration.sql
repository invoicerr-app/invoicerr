-- CreateTable
CREATE TABLE "CountryIdentifierRequirement" (
    "id" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "scheme" TEXT NOT NULL,
    "appliesTo" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL,
    "pattern" TEXT,
    "helpText" TEXT,
    "provenanceKind" TEXT NOT NULL,
    "sourceText" TEXT,
    "sourceCheckedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CountryIdentifierRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CountryIdentifierRequirement_countryCode_idx" ON "CountryIdentifierRequirement"("countryCode");

-- CreateIndex
CREATE UNIQUE INDEX "CountryIdentifierRequirement_countryCode_scheme_key" ON "CountryIdentifierRequirement"("countryCode", "scheme");
