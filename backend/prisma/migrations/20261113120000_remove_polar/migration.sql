-- Polar is removed: hosted billing runs through the Stripe plugin (`subscription` table).

-- AlterTable: keep the "this company once paid" fact the lifecycle reads, before its Polar source goes.
ALTER TABLE "company_subscription" ADD COLUMN "firstPaidAt" TIMESTAMP(3);
UPDATE "company_subscription" SET "firstPaidAt" = "updatedAt" WHERE "polarSubscriptionId" IS NOT NULL;

-- AlterTable: the sweep's compare-and-set anchor stays, under a provider-neutral name.
ALTER TABLE "company_subscription" RENAME COLUMN "lastPolarFactAt" TO "lastBillingFactAt";

-- AlterTable
ALTER TABLE "company_subscription" DROP COLUMN "polarCustomerId",
DROP COLUMN "polarSubscriptionId",
DROP COLUMN "seatPaymentFailedAt",
DROP COLUMN "customerSyncFailedAt",
DROP COLUMN "lastCheckoutStartedAt";

-- AlterTable
ALTER TABLE "Company" DROP COLUMN "billingEmail";

-- DropTable
DROP TABLE "polar_webhook_event";
