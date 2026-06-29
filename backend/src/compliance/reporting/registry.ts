import { TransactionContext } from '../canonical/canonical-document';
import { CompliancePlan } from '../engine/compliance-engine';
import { ComplianceLogger, defaultLogger } from '../execution/logger';
import { ReportingResult } from '../execution/types';
import { ReportingKind } from '../types';
import { ReportingHandler } from './reporting-handler';
import {
  CustomsExportReportingHandler,
  EcSalesListReportingHandler,
  EReportingReportingHandler,
  IntrastatReportingHandler,
  IossReportingHandler,
  OssReportingHandler,
  SaftReportingHandler,
  SalesPurchaseLedgerReportingHandler,
} from './handlers';
import { NullReportingStore, ReportingStore } from './reporting-store';

export class ReportingRegistry {
  private readonly byKind = new Map<ReportingKind, ReportingHandler>();

  constructor(handlers?: ReportingHandler[], store?: ReportingStore) {
    const s = store ?? new NullReportingStore();
    const list = handlers ?? [
      new EcSalesListReportingHandler(s),
      new IntrastatReportingHandler(s),
      new OssReportingHandler(s),
      new IossReportingHandler(s),
      new SaftReportingHandler(s),
      new EReportingReportingHandler(s),
      new SalesPurchaseLedgerReportingHandler(s),
      new CustomsExportReportingHandler(s),
    ];
    for (const h of list) this.byKind.set(h.kind, h);
  }

  get(kind: ReportingKind): ReportingHandler | null {
    return this.byKind.get(kind) ?? null;
  }

  async reportAll(
    ctx: TransactionContext,
    plan: CompliancePlan,
    log: ComplianceLogger = defaultLogger,
  ): Promise<ReportingResult[]> {
    const results: ReportingResult[] = [];
    for (const kind of plan.reporting) {
      const handler = this.get(kind);
      if (!handler) {
        log.warn('reporting', `no handler for ${kind}`);
        results.push({ kind, status: 'SKIPPED' as const });
      } else {
        results.push(await handler.report(ctx, plan, log));
      }
    }
    return results;
  }
}

export const defaultReportingRegistry = new ReportingRegistry();
