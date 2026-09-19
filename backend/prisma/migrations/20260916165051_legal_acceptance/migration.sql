-- CreateTable
CREATE TABLE "legal_acceptance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "documentSlug" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "legal_acceptance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "legal_acceptance_userId_idx" ON "legal_acceptance"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "legal_acceptance_userId_documentSlug_version_key" ON "legal_acceptance"("userId", "documentSlug", "version");

-- AddForeignKey
ALTER TABLE "legal_acceptance" ADD CONSTRAINT "legal_acceptance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
