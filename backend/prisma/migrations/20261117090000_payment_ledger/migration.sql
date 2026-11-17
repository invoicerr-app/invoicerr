-- DropForeignKey
ALTER TABLE "DocumentPayment" DROP CONSTRAINT "DocumentPayment_documentId_fkey";

-- AlterTable
ALTER TABLE "DocumentPayment" ADD COLUMN     "hash" TEXT,
ADD COLUMN     "ledgerSequence" INTEGER,
ADD COLUMN     "previousHash" TEXT,
ADD COLUMN     "reversesPaymentId" TEXT,
ADD COLUMN     "signature" TEXT;

-- CreateTable
CREATE TABLE "PaymentLedgerClosure" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "sequence" INTEGER NOT NULL,
    "paymentCount" INTEGER NOT NULL,
    "firstPaymentSequence" INTEGER,
    "lastPaymentSequence" INTEGER,
    "totals" JSONB NOT NULL,
    "perpetualTotals" JSONB NOT NULL,
    "previousHash" TEXT,
    "hash" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentLedgerClosure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentLedgerArchive" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "generatedBy" TEXT,
    "sha256" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentLedgerArchive_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentLedgerClosure_companyId_kind_periodStart_key" ON "PaymentLedgerClosure"("companyId", "kind", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentLedgerClosure_companyId_sequence_key" ON "PaymentLedgerClosure"("companyId", "sequence");

-- CreateIndex
CREATE INDEX "PaymentLedgerArchive_companyId_createdAt_idx" ON "PaymentLedgerArchive"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentPayment_reversesPaymentId_key" ON "DocumentPayment"("reversesPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentPayment_companyId_ledgerSequence_key" ON "DocumentPayment"("companyId", "ledgerSequence");

-- AddForeignKey
ALTER TABLE "DocumentPayment" ADD CONSTRAINT "DocumentPayment_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "DocumentInstance"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentPayment" ADD CONSTRAINT "DocumentPayment_reversesPaymentId_fkey" FOREIGN KEY ("reversesPaymentId") REFERENCES "DocumentPayment"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentLedgerClosure" ADD CONSTRAINT "PaymentLedgerClosure_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentLedgerArchive" ADD CONSTRAINT "PaymentLedgerArchive_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Payment ledger rows are append-only. A row may be updated once, to receive its seal; a row may only
-- be deleted once its company row is gone (company deletion cascades), never on its own.
CREATE FUNCTION "payment_ledger_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM "Company" WHERE "id" = OLD."companyId") THEN
      RAISE EXCEPTION 'PAYMENT_LEDGER_APPEND_ONLY: % rows cannot be deleted', TG_TABLE_NAME;
    END IF;
    RETURN OLD;
  END IF;
  -- Nested, not one AND: PL/pgSQL does not promise short-circuit, and only this table has a seal.
  IF TG_TABLE_NAME = 'DocumentPayment' THEN
    IF to_jsonb(OLD) ->> 'hash' IS NULL
       AND to_jsonb(NEW) ->> 'hash' IS NOT NULL
       AND to_jsonb(NEW) - ARRAY['ledgerSequence', 'previousHash', 'hash', 'signature']
         = to_jsonb(OLD) - ARRAY['ledgerSequence', 'previousHash', 'hash', 'signature'] THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'PAYMENT_LEDGER_APPEND_ONLY: % rows cannot be modified', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER "DocumentPayment_append_only"
  BEFORE UPDATE OR DELETE ON "DocumentPayment"
  FOR EACH ROW EXECUTE FUNCTION "payment_ledger_guard"();

CREATE TRIGGER "PaymentLedgerClosure_append_only"
  BEFORE UPDATE OR DELETE ON "PaymentLedgerClosure"
  FOR EACH ROW EXECUTE FUNCTION "payment_ledger_guard"();

CREATE TRIGGER "PaymentLedgerArchive_append_only"
  BEFORE UPDATE OR DELETE ON "PaymentLedgerArchive"
  FOR EACH ROW EXECUTE FUNCTION "payment_ledger_guard"();
