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
} from './generators';

// ---------------------------------------------------------------------------
// Shared base logic
// ---------------------------------------------------------------------------

async function handleReport<P>(
  kind: ReportingKind,
  ctx: TransactionContext,
  plan: CompliancePlan,
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
    log.info(`reporting/${kind}`, `idempotent skip: record ${existing.id} already ${existing.status} for period ${periodKey}`);
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
    payload: payload as any,
    submittedRef: null,
    submittedAt: null,
  });

  // Mocked submission seam — real I/O plugged in per-kind when authority creds available
  log.info(
    `reporting/${kind}`,
    `[MOCK] ${submitLabel} — period=${periodKey} record=${record.id} invoiceRef=${invoiceRef ?? 'n/a'}`,
  );

  return { kind, status: 'EMITTED', ref: record.id };
}

// ---------------------------------------------------------------------------
// Handler implementations
// ---------------------------------------------------------------------------

export class EReportingReportingHandler implements ReportingHandler {
  readonly kind: ReportingKind = 'E_REPORTING';
  constructor(private readonly store: ReportingStore = new NullReportingStore()) {}

  async report(ctx: TransactionContext, plan: CompliancePlan, log: ComplianceLogger): Promise<ReportingResult> {
    return handleReport(
      this.kind, ctx, plan, log, this.store,
      () => {
        const periodKey = getPeriodKey(ctx.issueDate, frequencyForKind(this.kind));
        return generateEReportingPayload(ctx, plan, periodKey);
      },
      'push e-reporting transaction to FR PDP/PPF (mocked)',
    );
  }
}

export class SaftReportingHandler implements ReportingHandler {
  readonly kind: ReportingKind = 'SAFT';
  constructor(private readonly store: ReportingStore = new NullReportingStore()) {}

  async report(ctx: TransactionContext, plan: CompliancePlan, log: ComplianceLogger): Promise<ReportingResult> {
    return handleReport(
      this.kind, ctx, plan, log, this.store,
      () => {
        const periodKey = getPeriodKey(ctx.issueDate, frequencyForKind(this.kind));
        return generateSaftEntry(ctx, plan, periodKey);
      },
      'append SAF-T SalesInvoice entry to monthly batch (mocked)',
    );
  }
}

export class OssReportingHandler implements ReportingHandler {
  readonly kind: ReportingKind = 'OSS';
  constructor(private readonly store: ReportingStore = new NullReportingStore()) {}

  async report(ctx: TransactionContext, plan: CompliancePlan, log: ComplianceLogger): Promise<ReportingResult> {
    return handleReport(
      this.kind, ctx, plan, log, this.store,
      () => {
        const periodKey = getPeriodKey(ctx.issueDate, frequencyForKind(this.kind));
        return generateOssEntry(ctx, plan, periodKey);
      },
      'add line to OSS quarterly VAT return (mocked)',
    );
  }
}

export class IossReportingHandler implements ReportingHandler {
  readonly kind: ReportingKind = 'IOSS';
  constructor(private readonly store: ReportingStore = new NullReportingStore()) {}

  async report(ctx: TransactionContext, plan: CompliancePlan, log: ComplianceLogger): Promise<ReportingResult> {
    return handleReport(
      this.kind, ctx, plan, log, this.store,
      () => {
        const periodKey = getPeriodKey(ctx.issueDate, frequencyForKind(this.kind));
        return generateIossEntry(ctx, plan, periodKey);
      },
      'add line to IOSS quarterly return for imported goods (mocked)',
    );
  }
}

export class EcSalesListReportingHandler implements ReportingHandler {
  readonly kind: ReportingKind = 'EC_SALES_LIST';
  constructor(private readonly store: ReportingStore = new NullReportingStore()) {}

  async report(ctx: TransactionContext, plan: CompliancePlan, log: ComplianceLogger): Promise<ReportingResult> {
    return handleReport(
      this.kind, ctx, plan, log, this.store,
      () => {
        const periodKey = getPeriodKey(ctx.issueDate, frequencyForKind(this.kind));
        return generateEcSalesListEntry(ctx, plan, periodKey);
      },
      'add line to EC Sales List / recapitulative statement (mocked)',
    );
  }
}

export class IntrastatReportingHandler implements ReportingHandler {
  readonly kind: ReportingKind = 'INTRASTAT';
  constructor(private readonly store: ReportingStore = new NullReportingStore()) {}

  async report(ctx: TransactionContext, plan: CompliancePlan, log: ComplianceLogger): Promise<ReportingResult> {
    return handleReport(
      this.kind, ctx, plan, log, this.store,
      () => {
        const periodKey = getPeriodKey(ctx.issueDate, frequencyForKind(this.kind));
        return generateIntrastatEntry(ctx, plan, periodKey);
      },
      'add movement to monthly Intrastat declaration (mocked)',
    );
  }
}

export class SalesPurchaseLedgerReportingHandler implements ReportingHandler {
  readonly kind: ReportingKind = 'SALES_PURCHASE_LEDGER';
  constructor(private readonly store: ReportingStore = new NullReportingStore()) {}

  async report(ctx: TransactionContext, plan: CompliancePlan, log: ComplianceLogger): Promise<ReportingResult> {
    return handleReport(
      this.kind, ctx, plan, log, this.store,
      () => {
        const periodKey = getPeriodKey(ctx.issueDate, frequencyForKind(this.kind));
        return generateSalesPurchaseLedgerEntry(ctx, plan, periodKey);
      },
      'append entry to sales/purchase register (mocked)',
    );
  }
}

export class CustomsExportReportingHandler implements ReportingHandler {
  readonly kind: ReportingKind = 'CUSTOMS_EXPORT';
  constructor(private readonly store: ReportingStore = new NullReportingStore()) {}

  async report(ctx: TransactionContext, plan: CompliancePlan, log: ComplianceLogger): Promise<ReportingResult> {
    return handleReport(
      this.kind, ctx, plan, log, this.store,
      () => generateCustomsExportPayload(ctx, plan),
      'attach customs/export evidence for zero-rating (mocked)',
    );
  }
}
