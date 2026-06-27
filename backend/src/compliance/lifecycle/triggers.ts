/**
 * Lifecycle triggers (COMPLIANCE_LIFECYCLE.md §3). A transition declares not only `from → to` but
 * *how* it is driven. The driver for an async phase is bound from the resolved channel provider's
 * `feedback` model — this is why a "super PDP" (callback) lives differently from email (none) or a
 * polled portal (poll), with no per-country code.
 */
import { ChannelFeedback, PollPolicy } from '../providers/transmission/transmission-provider';
import { ComplianceEvent, ComplianceStatus } from './state-machine';

export type Trigger =
  | { kind: 'IMMEDIATE' } // the transmit()/issue() result is final, applied inline
  | { kind: 'POLL'; poll: PollPolicy; channelProviderId?: string } // ask the third party periodically
  | { kind: 'CALLBACK'; correlationKey?: string } // wait for an inbound webhook / notifica / status
  | { kind: 'TIMER'; deadlineHours?: number; onElapse: ComplianceEvent } // silence = acceptance
  | { kind: 'MANUAL'; action: string } // user / API command
  | { kind: 'CONTINGENCY' }; // authority outage path

/** One edge of the composed lifecycle graph. */
export interface TransitionSpec {
  on: ComplianceEvent; // the event that performs this transition
  from: ComplianceStatus;
  to: ComplianceStatus;
  trigger: Trigger; // how `on` is produced when sitting in `from`
  guardKey?: string; // optional named precondition: 'buyerConsent' | 'authorityAck' | 'reason'
  description?: string;
}

const DEFAULT_POLL: PollPolicy = { everySeconds: 60, timeoutHours: 48, backoff: 'EXPONENTIAL' };

/**
 * Maps a channel's feedback model to the trigger that should drive an *asynchronous* phase
 * (clearance / delivery confirmation). `onSilence`, when given, turns a NONE/SYNC channel that still
 * has a deadline (buyer response with silence=acceptance) into a TIMER instead of IMMEDIATE.
 */
export function triggerForFeedback(
  feedback: ChannelFeedback | undefined,
  opts: { poll?: PollPolicy; providerId?: string } = {},
): Trigger {
  switch (feedback) {
    case 'ASYNC_POLL':
      return { kind: 'POLL', poll: opts.poll ?? DEFAULT_POLL, channelProviderId: opts.providerId };
    case 'ASYNC_CALLBACK':
      return { kind: 'CALLBACK' };
    case 'SYNC':
    case 'NONE':
    case undefined:
    default:
      return { kind: 'IMMEDIATE' };
  }
}
