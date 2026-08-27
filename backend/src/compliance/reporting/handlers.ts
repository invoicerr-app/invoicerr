/**
 * Concrete ReportingHandler implementations — one per ReportingKind (§6 COMPLIANCE_TODO.md).
 *
 * Each handler:
 *  1. Computes a period key (monthly or quarterly) for the transaction date.
 *  2. Checks idempotence via the ReportingStore (find by kind+period+company+invoiceRef).
 *  3. If already filed → returns SKIPPED (no-op).
 *  4. Otherwise, calls the pure generator to produce a structured payload.
 *  5. Persists the record via the store (status=PENDING).
 *  6. Mocked submission seam: logs the intent; real I/O is a TODO per kind.
 *  7. Returns ReportingResult with status=EMITTED and ref=record.id.
 *
 * Generators are pure functions in ./generators.ts — unit-testable without I/O.
 * Store is injected (NullReportingStore by default for unit tests; PrismaReportingStore in prod).
 *
 * All handlers share the exact same shape, so they are stamped out by
 * makeReportingHandler(kind, generator, submitLabel).
 */
import { TransactionContext } from '../canonical/canonical-document';
import { CompliancePlan } from '../engine/compliance-engine';
import { ComplianceLogger } from '../execution/logger';
import { ReportingResult } from '../execution/types';
import { ReportingKind } from '../types';
import { ReportingHandler } from './reporting-handler';
import { NullReportingStore, ReportingStore } from './reporting-store';
import { frequencyForKind, getPeriodKey } from './period';
import {
  generateCustomsExportPayload,
  generateEcSalesListEntry,
  generateEReportingPayload,
  generateIossEntry,
  generateIntrastatEntry,
  generateOssEntry,
  generateSaftEntry,
  generateSalesPurchaseLedgerEntry,
  generateSiiRegistroPayload,
  generateVerifactuRegistroPayload,
} from './generators';

// ---------------------------------------------------------------------------
// Shared logic
// ---------------------------------------------------------------------------

async function handleReport<P>(
  kind: ReportingKind,
  ctx: TransactionContext,
  _plan: CompliancePlan,
  log: ComplianceLogger,
  store: ReportingStore,
  generatePayload: () => P,
  submitLabel: string,
): Promise<ReportingResult> {
  const periodKey = getPeriodKey(ctx.issueDate, frequencyForKind(kind));
  const companyId = ctx.supplierCompanyId ?? null;
  const invoiceRef = ctx.externalRef ?? null;

  // Idempotence check: one record per (kind, period, company, invoice)
  const existing = await store.find(kind, periodKey, companyId, invoiceRef);
  if (existing) {
    log.info(
      `reporting/${kind}`,
      `idempotent skip: record ${existing.id} already ${existing.status} for period ${periodKey}`,
    );
    return { kind, status: 'SKIPPED', ref: existing.id };
  }

  // Generate the structured payload (pure, synchronous)
  const payload = generatePayload();

  // Persist (status=PENDING)
  const record = await store.create({
    kind,
    periodKey,
    companyId,
    invoiceRef,
    status: 'PENDING',
    payload,
    submittedRef: null,
    submittedAt: null,
  });

  // Mocked submission seam — real I/O plugged in per-kind when authority creds available
  log.info(
    `reporting/${kind}`,
    `[MOCK] ${submitLabel} — period=${periodKey} record=${record.id} invoiceRef=${invoiceRef ?? 'n/a'}`,
  );

  // F-016: the payload is real and persisted, the submission is not. `mocked` carries that to the
  // caller instead of leaving it in a log line.
  return { kind, status: 'EMITTED', ref: record.id, mocked: true };
}

// ---------------------------------------------------------------------------
// Handler factory
// ---------------------------------------------------------------------------

type ReportingHandlerClass = new (store?: ReportingStore) => ReportingHandler;

function makeReportingHandler(
  kind: ReportingKind,
  generate: (ctx: TransactionContext, plan: CompliancePlan, periodKey: string) => unknown,
  submitLabel: string,
): ReportingHandlerClass {
  return class implements ReportingHandler {
    readonly kind: ReportingKind = kind;
    constructor(private readonly store: ReportingStore = new NullReportingStore()) {}

    async report(
      ctx: TransactionContext,
      plan: CompliancePlan,
      log: ComplianceLogger,
    ): Promise<ReportingResult> {
      return handleReport(
        kind,
        ctx,
        plan,
        log,
        this.store,
        () => {
          const periodKey = getPeriodKey(ctx.issueDate, frequencyForKind(kind));
          return generate(ctx, plan, periodKey);
        },
        submitLabel,
      );
    }
  };
}

// ---------------------------------------------------------------------------
// Handler implementations
// ---------------------------------------------------------------------------

export const EReportingReportingHandler = makeReportingHandler(
  'E_REPORTING',
  generateEReportingPayload,
  'push e-reporting transaction to FR PDP/PPF (mocked)',
);

export const SaftReportingHandler = makeReportingHandler(
  'SAFT',
  generateSaftEntry,
  'append SAF-T SalesInvoice entry to monthly batch (mocked)',
);

export const OssReportingHandler = makeReportingHandler(
  'OSS',
  generateOssEntry,
  'add line to OSS quarterly VAT return (mocked)',
);

export const IossReportingHandler = makeReportingHandler(
  'IOSS',
  generateIossEntry,
  'add line to IOSS quarterly return for imported goods (mocked)',
);

export const EcSalesListReportingHandler = makeReportingHandler(
  'EC_SALES_LIST',
  generateEcSalesListEntry,
  'add line to EC Sales List / recapitulative statement (mocked)',
);

export const IntrastatReportingHandler = makeReportingHandler(
  'INTRASTAT',
  generateIntrastatEntry,
  'add movement to monthly Intrastat declaration (mocked)',
);

export const SalesPurchaseLedgerReportingHandler = makeReportingHandler(
  'SALES_PURCHASE_LEDGER',
  generateSalesPurchaseLedgerEntry,
  'append entry to sales/purchase register (mocked)',
);

export const CustomsExportReportingHandler = makeReportingHandler(
  'CUSTOMS_EXPORT',
  (ctx, plan) => generateCustomsExportPayload(ctx, plan),
  'attach customs/export evidence for zero-rating (mocked)',
);

export const SiiReportingHandler = makeReportingHandler(
  'SII',
  generateSiiRegistroPayload,
  'upload SuministroLRFacturasEmitidas registration to AEAT SII (mocked)',
);

// previousHuella defaults to '' (first record in the chain) — see the TODO(seam) on
// generateVerifactuRegistroPayload for how a real cross-invoice chain must feed the prior huella.
export const VerifactuReportingHandler = makeReportingHandler(
  'VERIFACTU',
  generateVerifactuRegistroPayload,
  'submit Verifactu RegistroAlta (hash-chained) to AEAT (mocked)',
);
