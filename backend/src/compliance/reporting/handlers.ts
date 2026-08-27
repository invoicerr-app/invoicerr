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
  generatePayload: () => P | Promise<P>,
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

  // Generate the structured payload. The generators themselves stay pure; the builder may be async
  // because ONE kind — VERIFACTU — has to read the previous link of its hash chain before it can
  // generate (ES-D1). Awaiting a plain value is a no-op for every other kind.
  const payload = await generatePayload();

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

/**
 * ES-D1 — the Veri*Factu chain, actually chained.
 *
 * The huella algorithm was never the defect: it reproduces AEAT's two published worked examples
 * (doc "Especificaciones técnicas para generación de la huella o hash", v0.1.2 of 2024-08-27)
 * byte-for-byte, chained case included. The defect was that nobody ever fed it a previous link.
 * `previousHuella` defaulted to `''` and no caller overrode it, so every single record hashed an
 * empty `Huella=` and reported `PrimerRegistro='S'` — a chain of length one, repeated, where art.
 * 8.2.b of RD 1007/2023 requires each registro to be tied to its predecessor.
 *
 * The fix is a query, not a new source: read this issuer's last VERIFACTU record through the
 * ReportingStore port and pass its huella in. Which is why this kind cannot use
 * `makeReportingHandler` — that factory takes a PURE generator, and this one needs one store read
 * first. The generator itself stays pure and untouched.
 */
export class VerifactuReportingHandler implements ReportingHandler {
  readonly kind: ReportingKind = 'VERIFACTU';
  constructor(private readonly store: ReportingStore = new NullReportingStore()) {}

  async report(
    ctx: TransactionContext,
    plan: CompliancePlan,
    log: ComplianceLogger,
  ): Promise<ReportingResult> {
    return handleReport(
      'VERIFACTU',
      ctx,
      plan,
      log,
      this.store,
      async () => {
        const periodKey = getPeriodKey(ctx.issueDate, frequencyForKind('VERIFACTU'));
        const previous = await this.store.findLastByKindAndCompany(
          'VERIFACTU',
          ctx.supplierCompanyId ?? null,
        );
        // Read defensively: `payload` is a Json column, so a row written by an older build (or a
        // hand-edited one) may not carry a huella. An unreadable predecessor must NOT silently
        // restart the chain as if this were the first record — that is the exact failure being
        // fixed — so it is logged loudly and left to the caller to investigate.
        const previousHuella = (previous?.payload as { huella?: unknown } | null)?.huella;
        if (previous && typeof previousHuella !== 'string') {
          log.warn(
            'reporting/VERIFACTU',
            `previous record ${previous.id} carries no readable huella — this registro will declare PrimerRegistro='S' and BREAK the chain`,
          );
        }
        return generateVerifactuRegistroPayload(
          ctx,
          plan,
          periodKey,
          typeof previousHuella === 'string' ? previousHuella : '',
        );
      },
      'submit Verifactu RegistroAlta (hash-chained) to AEAT (mocked)',
    );
  }
}
