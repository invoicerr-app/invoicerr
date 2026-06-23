import { TransactionContext } from '../../canonical/canonical-document';
import { CompliancePlan } from '../../engine/compliance-engine';
import { ComplianceLogger } from '../../execution/logger';
import { SignedArtifact, TransmissionResult } from '../../execution/types';
import { ChannelType } from '../../types';

/** Delivers the artifact over one channel (email, Peppol, a clearance API, a portal, print…) (§10). */
export interface TransmissionProvider {
  /** Stable provider id (e.g. 'email', 'sdi', 'ksef'); used for exact selection via ChannelSpec.providerId. */
  readonly id: string;
  readonly channel: ChannelType;
  transmit(
    artifacts: SignedArtifact[],
    ctx: TransactionContext,
    plan: CompliancePlan,
    idempotencyKey: string,
    log: ComplianceLogger,
  ): TransmissionResult;
  /** For asynchronous clearance channels: re-check status. */
  poll?(ref: string, log: ComplianceLogger): TransmissionResult;
}
