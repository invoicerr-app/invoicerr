/**
 * Phase contributors (COMPLIANCE_LIFECYCLE.md §2). Each is a pure function that, given the resolved
 * CompliancePlan + the channel's feedback context, returns a fragment of the lifecycle graph (states
 * + transitions) or null when it does not apply. The assembler composes the fragments into the
 * document's frozen graph. Mirrors the regimes/ and reporting/ handler+registry pattern.
 */
import { CompliancePlan } from '../../engine/compliance-engine';
import { ChannelFeedback, PollPolicy } from '../../providers/transmission/transmission-provider';
import { ComplianceStatus } from '../state-machine';
import { TransitionSpec } from '../triggers';

export interface PhaseFragment {
  states: ComplianceStatus[];
  transitions: TransitionSpec[];
}

/** What the assembler resolved about the primary channel — drives async triggers. */
export interface PhaseContext {
  channelFeedback?: ChannelFeedback;
  channelProviderId?: string;
  pollPolicy?: PollPolicy;
}

export interface PhaseContributor {
  readonly id: string;
  contributes(plan: CompliancePlan, pctx: PhaseContext): PhaseFragment | null;
}
