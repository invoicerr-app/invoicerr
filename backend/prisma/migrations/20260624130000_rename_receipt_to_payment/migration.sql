/*
  Renaming the Receipt domain to Payment as part of the receipt -> payment refactor.

  - Renamed table "Receipt" to "Payment"
  - Renamed table "ReceiptItem" to "PaymentItem"
  - Renamed column "ReceiptItem"."receiptId" to "PaymentItem"."paymentId"
  - Renamed column "PDFConfig"."receipt" to "PDFConfig"."payment"
  - Renamed primary keys / foreign keys to match Prisma naming conventions
  - Added new PAYMENT_* values to the "WebhookEvent" enum (old RECEIPT_* kept, deprecated)
  - Added PAYMENT value to the "MailTemplateType" enum (old RECEIPT kept, deprecated)

  Existing data is preserved; the MailTemplate rows are migrated to the new enum
  value in a separate migration (a freshly added enum value cannot be used in the
  same transaction that adds it).
*/

-- Rename tables
ALTER TABLE "Receipt" RENAME TO "Payment";
ALTER TABLE "ReceiptItem" RENAME TO "PaymentItem";

-- Rename foreign key column
ALTER TABLE "PaymentItem" RENAME COLUMN "receiptId" TO "paymentId";

-- Rename constraints to follow Prisma "<Table>_<col>_fkey" / "<Table>_pkey" convention
ALTER TABLE "Payment" RENAME CONSTRAINT "Receipt_pkey" TO "Payment_pkey";
ALTER TABLE "Payment" RENAME CONSTRAINT "Receipt_invoiceId_fkey" TO "Payment_invoiceId_fkey";
ALTER TABLE "PaymentItem" RENAME CONSTRAINT "ReceiptItem_pkey" TO "PaymentItem_pkey";
ALTER TABLE "PaymentItem" RENAME CONSTRAINT "ReceiptItem_invoiceItemId_fkey" TO "PaymentItem_invoiceItemId_fkey";
ALTER TABLE "PaymentItem" RENAME CONSTRAINT "ReceiptItem_receiptId_fkey" TO "PaymentItem_paymentId_fkey";

-- Rename the PDFConfig label column and migrate the untouched default value
ALTER TABLE "PDFConfig" RENAME COLUMN "receipt" TO "payment";
ALTER TABLE "PDFConfig" ALTER COLUMN "payment" SET DEFAULT 'Payment';
UPDATE "PDFConfig" SET "payment" = 'Payment' WHERE "payment" = 'Receipt';

-- Extend the MailTemplateType enum
ALTER TYPE "MailTemplateType" ADD VALUE 'PAYMENT';

-- Extend the WebhookEvent enum with the new payment document events
ALTER TYPE "WebhookEvent" ADD VALUE 'PAYMENT_CREATED';
ALTER TYPE "WebhookEvent" ADD VALUE 'PAYMENT_UPDATED';
ALTER TYPE "WebhookEvent" ADD VALUE 'PAYMENT_DELETED';
ALTER TYPE "WebhookEvent" ADD VALUE 'PAYMENT_SENT';
ALTER TYPE "WebhookEvent" ADD VALUE 'PAYMENT_PDF_GENERATED';
ALTER TYPE "WebhookEvent" ADD VALUE 'PAYMENT_CREATED_FROM_INVOICE';
ALTER TYPE "WebhookEvent" ADD VALUE 'PAYMENT_SEARCHED';
ALTER TYPE "WebhookEvent" ADD VALUE 'PAYMENT_ITEM_CREATED';
ALTER TYPE "WebhookEvent" ADD VALUE 'PAYMENT_ITEM_UPDATED';
ALTER TYPE "WebhookEvent" ADD VALUE 'PAYMENT_ITEM_DELETED';
ALTER TYPE "WebhookEvent" ADD VALUE 'PAYMENT_NUMBER_GENERATED';
