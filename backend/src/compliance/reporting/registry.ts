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

export class ReportingRegistry {
  private readonly byKind = new Map<ReportingKind, ReportingHandler>();

  constructor(handlers?: ReportingHandler[]) {
    const list = handlers ?? [
      new EcSalesListReportingHandler(),
      new IntrastatReportingHandler(),
      new OssReportingHandler(),
      new IossReportingHandler(),
      new SaftReportingHandler(),
      new EReportingReportingHandler(),
      new SalesPurchaseLedgerReportingHandler(),
      new CustomsExportReportingHandler(),
    ];
    for (const h of list) this.byKind.set(h.kind, h);
  }

  get(kind: ReportingKind): ReportingHandler | null {
    return this.byKind.get(kind) ?? null;
  }

  reportAll(
    ctx: TransactionContext,
    plan: CompliancePlan,
    log: ComplianceLogger = defaultLogger,
  ): ReportingResult[] {
    return plan.reporting.map((kind) => {
      const handler = this.get(kind);
      if (!handler) {
        log.warn('reporting', `no handler for ${kind}`);
        return { kind, status: 'SKIPPED' as const };
      }
      return handler.report(ctx, plan, log);
    });
  }
}

export const defaultReportingRegistry = new ReportingRegistry();
