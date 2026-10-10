-- CreateTable
CREATE TABLE "ClientPaymentMethodRestriction" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "methodId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientPaymentMethodRestriction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientPaymentMethodRestriction_clientId_idx" ON "ClientPaymentMethodRestriction"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientPaymentMethodRestriction_clientId_methodId_key" ON "ClientPaymentMethodRestriction"("clientId", "methodId");

-- AddForeignKey
ALTER TABLE "ClientPaymentMethodRestriction" ADD CONSTRAINT "ClientPaymentMethodRestriction_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
