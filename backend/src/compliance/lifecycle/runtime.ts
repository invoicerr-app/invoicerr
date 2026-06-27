/**
 * Lifecycle runtime (COMPLIANCE_LIFECYCLE.md §4). Interprets a frozen LifecycleGraph by processing
 * *signals* (commands + inbound) rather than direct mutations. The current status is a projection of
 * an append-only event log; each applied transition emits Effects that schedule the next driver
 * (poll / timer / callback) or outbound I/O. This skeleton keeps the control flow real and marks the
 * durable I/O (scheduler, outbox, persistence) with log.todo.
 */
import { ComplianceLogger, defaultLogger } from '../execution/logger';
import { PollPolicy } from '../providers/transmission/transmission-provider';
import { LifecycleGraph } from './assembler';
import { ComplianceEvent, ComplianceStatus } from './state-machine';
import { TransitionSpec, Trigger } from './triggers';

/** External things that can move the document along. */
export type LifecycleSignal =
  | { type: 'COMMAND'; event: ComplianceEvent } // user / API (issue, send, cancel, correct…)
  | { type: 'AUTHORITY_ACK'; cleared: boolean } // synchronous authority answer
  | { type: 'POLL_RESULT'; status: 'CLEARED' | 'REJECTED' | 'PENDING' } // scheduler poll outcome
  | { type: 'INBOUND_STATUS'; status: string } // callback: SdI/Peppol/PDP status message
  | { type: 'TIMER_ELAPSED' }; // silence = acceptance deadline

/** What the runtime asks the durable infrastructure to do next. */
export type Effect =
  | { kind: 'APPLIED'; event: ComplianceEvent; to: ComplianceStatus }
  | { kind: 'SCHEDULE_POLL'; poll: PollPolicy; channelProviderId?: string; awaiting: ComplianceStatus }
  | { kind: 'ARM_TIMER'; deadlineHours?: number; onElapse: ComplianceEvent; awaiting: ComplianceStatus }
  | { kind: 'AWAIT_CALLBACK'; correlationKey?: string; awaiting: ComplianceStatus }
  | { kind: 'NOOP'; reason: string };

const REFUSE_WORDS = ['refus', 'reject', 'rechaz', 'scart', 'denied'];
const ACCEPT_WORDS = ['accept', 'approv', 'approu', 'consegn', 'autoriz', 'cleared'];
const DISPUTE_WORDS = ['litige', 'disput'];

export class LifecycleRuntime {
  constructor(
    private readonly graph: LifecycleGraph,
    public status: ComplianceStatus = 'DRAFT',
    private readonly log: ComplianceLogger = defaultLogger,
  ) {}

  /** MANUAL transitions legal right now → the buttons the front should render. */
  availableActions(): TransitionSpec[] {
    return this.outgoing().filter((t) => t.trigger.kind === 'MANUAL');
  }

  /** Non-manual triggers armed at the current state → what the runtime is waiting on. */
  pendingDrivers(): Trigger[] {
    return this.outgoing()
      .map((t) => t.trigger)
      .filter((t) => t.kind === 'POLL' || t.kind === 'TIMER' || t.kind === 'CALLBACK');
  }

  /** Process one signal: resolve the event, apply the legal transition, schedule the next drivers. */
  dispatch(signal: LifecycleSignal): Effect[] {
    const event = this.eventFor(signal);
    if (!event) return [{ kind: 'NOOP', reason: `no transition for ${signal.type} in ${this.status}` }];

    const t = this.outgoing().find((tr) => tr.on === event);
    if (!t) {
      if (signal.type === 'COMMAND') {
        throw new Error(`Illegal action: cannot ${event} from ${this.status}`); // immutability guard
      }
      return [{ kind: 'NOOP', reason: `signal ${event} not applicable in ${this.status}` }];
    }

    this.status = t.to;
    this.log.info('lifecycle/runtime', `${t.from} --${event}--> ${t.to}`); // TODO persist as a ComplianceEvent
    return [{ kind: 'APPLIED', event, to: t.to }, ...this.armNext()];
  }

  // --- internals ---

  private outgoing(): TransitionSpec[] {
    return this.graph.transitions.filter((t) => t.from === this.status);
  }

  /**
   * Arm the drivers for the state we just entered (what should fire next, durably). Deduped by kind:
   * one poll loop / one timer / one callback wait per state, even when several outgoing edges share a
   * driver (e.g. PENDING_CLEARANCE has both CLEAR and REJECT polled — a single poll resolves either).
   */
  private armNext(): Effect[] {
    const effects: Effect[] = [];
    const seen = new Set<string>();
    for (const t of this.outgoing()) {
      switch (t.trigger.kind) {
        case 'POLL':
          if (seen.has('POLL')) break;
          seen.add('POLL');
          effects.push({ kind: 'SCHEDULE_POLL', poll: t.trigger.poll, channelProviderId: t.trigger.channelProviderId, awaiting: this.status });
          break;
        case 'TIMER':
          if (seen.has('TIMER')) break;
          seen.add('TIMER');
          effects.push({ kind: 'ARM_TIMER', deadlineHours: t.trigger.deadlineHours, onElapse: t.trigger.onElapse, awaiting: this.status });
          break;
        case 'CALLBACK':
          if (seen.has('CALLBACK')) break;
          seen.add('CALLBACK');
          effects.push({ kind: 'AWAIT_CALLBACK', correlationKey: t.trigger.correlationKey, awaiting: this.status });
          break;
        default:
          break; // IMMEDIATE = executed by the executor; MANUAL = waits for a user command
      }
    }
    return effects;
  }

  /** Translate a signal into the lifecycle event it performs, given the current state. */
  private eventFor(signal: LifecycleSignal): ComplianceEvent | null {
    switch (signal.type) {
      case 'COMMAND':
        return signal.event;
      case 'AUTHORITY_ACK':
        return signal.cleared ? 'CLEAR' : 'REJECT';
      case 'POLL_RESULT':
        return signal.status === 'CLEARED' ? 'CLEAR' : signal.status === 'REJECTED' ? 'REJECT' : null;
      case 'TIMER_ELAPSED': {
        const timed = this.outgoing().find((t) => t.trigger.kind === 'TIMER');
        return timed && timed.trigger.kind === 'TIMER' ? timed.trigger.onElapse : null;
      }
      case 'INBOUND_STATUS':
        return this.eventForStatus(signal.status);
    }
  }

  /** Map a free-text inbound status (SdI/Peppol/PDP/CDR) onto a transition event. */
  private eventForStatus(status: string): ComplianceEvent | null {
    const s = status.toLowerCase();
    const has = (words: string[]) => words.some((w) => s.includes(w));
    // Clearance phase callbacks
    if (this.status === 'PENDING_CLEARANCE' || this.status === 'CONTINGENCY') {
      if (has(REFUSE_WORDS)) return 'REJECT';
      if (has(ACCEPT_WORDS)) return 'CLEAR';
    }
    // Buyer-response phase callbacks
    if (this.status === 'AWAITING_RESPONSE') {
      if (has(DISPUTE_WORDS)) return 'DISPUTE';
      if (has(REFUSE_WORDS)) return 'REFUSE';
      if (has(ACCEPT_WORDS)) return 'ACCEPT';
    }
    this.log.todo('lifecycle/runtime', `map inbound status "${status}" to an event in ${this.status}`);
    return null;
  }
}
