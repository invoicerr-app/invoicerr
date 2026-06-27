import { TransactionContext } from '../canonical/canonical-document';
import { CompliancePlan } from '../engine/compliance-engine';
import { ComplianceLogger } from '../execution/logger';
import { ReportingResult } from '../execution/types';
import { ReportingKind } from '../types';
import { ReportingHandler } from './reporting-handler';

function queued(kind: ReportingKind, scope: string, detail: string, log: ComplianceLogger): ReportingResult {
  log.todo(`reporting/${scope}`, detail);
  return { kind, status: 'QUEUED' };
}

export class EcSalesListReportingHandler implements ReportingHandler {
  readonly kind: ReportingKind = 'EC_SALES_LIST';
  report(_ctx: TransactionContext, _plan: CompliancePlan, log: ComplianceLogger): ReportingResult {
    return queued(this.kind, 'ec-sales-list', 'add line to the EC Sales List / DEB-DES recapitulative statement', log);
  }
}

export class IntrastatReportingHandler implements ReportingHandler {
  readonly kind: ReportingKind = 'INTRASTAT';
  report(_ctx: TransactionContext, _plan: CompliancePlan, log: ComplianceLogger): ReportingResult {
    return queued(this.kind, 'intrastat', 'add movement to the Intrastat declaration (threshold-gated)', log);
  }
}

export class OssReportingHandler implements ReportingHandler {
  readonly kind: ReportingKind = 'OSS';
  report(_ctx: TransactionContext, _plan: CompliancePlan, log: ComplianceLogger): ReportingResult {
    return queued(this.kind, 'oss', 'add line to the OSS return (destination VAT for distance sales)', log);
  }
}

export class IossReportingHandler implements ReportingHandler {
  readonly kind: ReportingKind = 'IOSS';
  report(_ctx: TransactionContext, _plan: CompliancePlan, log: ComplianceLogger): ReportingResult {
    return queued(this.kind, 'ioss', 'add line to the IOSS return (imported goods <= EUR 150)', log);
  }
}

export class SaftReportingHandler implements ReportingHandler {
  readonly kind: ReportingKind = 'SAFT';
  report(_ctx: TransactionContext, _plan: CompliancePlan, log: ComplianceLogger): ReportingResult {
    return queued(this.kind, 'saft', 'append entry to the SAF-T batch (e.g. PT/AO/MZ)', log);
  }
}

export class EReportingReportingHandler implements ReportingHandler {
  readonly kind: ReportingKind = 'E_REPORTING';
  report(_ctx: TransactionContext, _plan: CompliancePlan, log: ComplianceLogger): ReportingResult {
    return queued(this.kind, 'e-reporting', 'push transaction + payment data to the tax authority (FR e-reporting)', log);
  }
}

export class SalesPurchaseLedgerReportingHandler implements ReportingHandler {
  readonly kind: ReportingKind = 'SALES_PURCHASE_LEDGER';
  report(_ctx: TransactionContext, _plan: CompliancePlan, log: ComplianceLogger): ReportingResult {
    return queued(this.kind, 'sales-purchase-ledger', 'append to the sales/purchase register (PE SIRE, CL daily summary)', log);
  }
}

export class CustomsExportReportingHandler implements ReportingHandler {
  readonly kind: ReportingKind = 'CUSTOMS_EXPORT';
  report(_ctx: TransactionContext, _plan: CompliancePlan, log: ComplianceLogger): ReportingResult {
    return queued(this.kind, 'customs-export', 'attach customs/export evidence for zero-rating', log);
  }
}
