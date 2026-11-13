-- CreateTable
CREATE TABLE "founder_preorder" (
    "id" TEXT NOT NULL,
    "stripeCheckoutSessionId" TEXT NOT NULL,
    "stripeCustomerId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "seats" INTEGER NOT NULL,
    "interval" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "claimedByCompanyId" TEXT,
    "claimedAt" TIMESTAMP(3),
    "stripeSubscriptionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "founder_preorder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "founder_preorder_stripeCheckoutSessionId_key" ON "founder_preorder"("stripeCheckoutSessionId");

-- CreateIndex
CREATE INDEX "founder_preorder_email_idx" ON "founder_preorder"("email");
