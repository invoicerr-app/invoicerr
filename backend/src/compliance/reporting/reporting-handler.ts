import { TransactionContext } from '../canonical/canonical-document';
import { CompliancePlan } from '../engine/compliance-engine';
import { ComplianceLogger } from '../execution/logger';
import { ReportingResult } from '../execution/types';
import { ReportingKind } from '../types';

/** Emits one reporting side-effect (EC Sales List, OSS, SAF-T, e-reporting…) (§10/§12). */
export interface ReportingHandler {
  readonly kind: ReportingKind;
  report(ctx: TransactionContext, plan: CompliancePlan, log: ComplianceLogger): ReportingResult;
}
