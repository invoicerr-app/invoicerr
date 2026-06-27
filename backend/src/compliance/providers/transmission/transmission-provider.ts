import { TransactionContext } from '../../canonical/canonical-document';
import { CompliancePlan } from '../../engine/compliance-engine';
import { ComplianceLogger } from '../../execution/logger';
import { SignedArtifact, TransmissionResult } from '../../execution/types';
import { ChannelType } from '../../types';

/**
 * How a channel reports the document's evolving state back to us — drives the lifecycle trigger
 * (COMPLIANCE_LIFECYCLE.md §3). This is a property of the *channel/provider*, NOT the country:
 * it is why a "super PDP" (callback) lives differently from email (none) or a polled portal.
 *  - SYNC           : the transmit() result is final (rare).
 *  - ASYNC_POLL     : we must call poll() periodically to learn CLEARED/REJECTED (PAC, most portals).
 *  - ASYNC_CALLBACK : the channel pushes statuses to us (SdI notifiche, Peppol MLR, a PDP).
 *  - NONE           : fire-and-forget, no downstream state (plain email, real-time report).
 */
export type ChannelFeedback = 'SYNC' | 'ASYNC_POLL' | 'ASYNC_CALLBACK' | 'NONE';

export interface PollPolicy {
  everySeconds: number;
  timeoutHours: number;
  backoff?: 'NONE' | 'EXPONENTIAL';
}

/** Delivers the artifact over one channel (email, Peppol, a clearance API, a portal, print…) (§10). */
export interface TransmissionProvider {
  /** Stable provider id (e.g. 'email', 'sdi', 'ksef'); used for exact selection via ChannelSpec.providerId. */
  readonly id: string;
  readonly channel: ChannelType;
  /** Feedback model driving the lifecycle (defaults to NONE when omitted). */
  readonly feedback?: ChannelFeedback;
  /** Cadence/timeout for ASYNC_POLL providers. */
  readonly pollPolicy?: PollPolicy;
  transmit(
    artifacts: SignedArtifact[],
    ctx: TransactionContext,
    plan: CompliancePlan,
    idempotencyKey: string,
    log: ComplianceLogger,
  ): TransmissionResult | Promise<TransmissionResult>;
  /** For asynchronous clearance channels: re-check status. */
  poll?(ref: string, log: ComplianceLogger): TransmissionResult;

  /**
   * Push a lifecycle status update (not a document) to this channel — e.g. FR "encaissée"
   * relayed by a PDP, or a buyer accept/refuse acknowledgement. Only channels that carry an
   * outbound status model implement it (PDP, SDI, Peppol). Returns a TransmissionResult like
   * transmit().
   */
  sendStatus?(
    ref: string,
    status: string,
    ctx: TransactionContext,
    plan: CompliancePlan,
    log: ComplianceLogger,
  ): TransmissionResult;
}
