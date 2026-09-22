-- AlterTable
ALTER TABLE "company_subscription" ADD COLUMN     "billingWarningMilestonesSent" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "customerSyncFailedAt" TIMESTAMP(3),
ADD COLUMN     "lastCheckoutStartedAt" TIMESTAMP(3),
ADD COLUMN     "lastPolarFactAt" TIMESTAMP(3),
ADD COLUMN     "seatPaymentFailedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "polar_webhook_event" (
    "id" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "polar_webhook_event_pkey" PRIMARY KEY ("id")
);
