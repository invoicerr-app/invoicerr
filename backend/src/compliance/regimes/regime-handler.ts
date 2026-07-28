import { TransactionContext } from '../canonical/canonical-document';
import { CompliancePlan } from '../engine/compliance-engine';
import { ComplianceLogger } from '../execution/logger';
import { RegimeResult, SignedArtifact } from '../execution/types';
import { RegimeModel } from '../types';

/**
 * Encapsulates the regime-specific behaviour: whether issuance is blocked pending clearance, what
 * the authority interaction is, and what identifiers come back (§8/§11).
 */
export interface RegimeHandler {
  readonly model: RegimeModel;
  handle(
    ctx: TransactionContext,
    plan: CompliancePlan,
    signed: SignedArtifact[],
    log: ComplianceLogger,
  ): RegimeResult;
}
