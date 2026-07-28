-- AlterTable: RecurringInvoice — add autoIssue, paused, skipNext
ALTER TABLE "RecurringInvoice" ADD COLUMN "autoIssue" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "RecurringInvoice" ADD COLUMN "paused" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "RecurringInvoice" ADD COLUMN "skipNext" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: Invoice — add recurringPeriodKey
ALTER TABLE "Invoice" ADD COLUMN "recurringPeriodKey" TEXT;

-- CreateIndex: unique constraint on (recurringInvoiceId, recurringPeriodKey)
CREATE UNIQUE INDEX "Invoice_recurringInvoiceId_recurringPeriodKey_key" ON "Invoice"("recurringInvoiceId", "recurringPeriodKey");
