-- CreateEnum
CREATE TYPE "ErrorTrackingConsentChannel" AS ENUM ('banner', 'settings');

-- CreateEnum
CREATE TYPE "ErrorTrackingConsentDecision" AS ENUM ('granted', 'refused', 'withdrawn');

-- CreateTable
CREATE TABLE "error_tracking_consent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "decision" "ErrorTrackingConsentDecision" NOT NULL,
    "textVersion" TEXT NOT NULL,
    "channel" "ErrorTrackingConsentChannel" NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "error_tracking_consent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "error_tracking_consent_userId_decidedAt_idx" ON "error_tracking_consent"("userId", "decidedAt");

-- AddForeignKey
ALTER TABLE "error_tracking_consent" ADD CONSTRAINT "error_tracking_consent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
