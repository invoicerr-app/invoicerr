/**
 * The concrete phase contributors (COMPLIANCE_LIFECYCLE.md §2). Each returns a graph fragment gated
 * by the plan; the assembler composes them. Every (from,on,to) triple here is a subset of the legal
 * superset in state-machine.ts, so the composed graph is always valid.
 */
import { CompliancePlan } from '../../engine/compliance-engine';
import { PhaseContext, PhaseContributor, PhaseFragment } from './phase-contributor';
import { triggerForFeedback } from '../triggers';

/** DRAFT → ISSUED. Always present. */
export class IssuancePhase implements PhaseContributor {
  readonly id = 'issuance';
  contributes(): PhaseFragment {
    return {
      states: ['DRAFT', 'ISSUED'],
      transitions: [
        { on: 'ISSUE', from: 'DRAFT', to: 'ISSUED', trigger: { kind: 'MANUAL', action: 'issue' }, description: 'number, hash-chain, freeze canonical snapshot' },
      ],
    };
  }
}

/** Blocking clearance: the invoice is invalid until the authority authorises it. */
export class ClearancePhase implements PhaseContributor {
  readonly id = 'clearance';
  contributes(plan: CompliancePlan, pctx: PhaseContext): PhaseFragment | null {
    if (!plan.regime.blocking) return null;
    const driver = triggerForFeedback(pctx.channelFeedback, { poll: pctx.pollPolicy, providerId: pctx.channelProviderId });
    return {
      states: ['PENDING_CLEARANCE', 'CLEARED', 'REJECTED', 'CONTINGENCY'],
      transitions: [
        { on: 'SUBMIT_CLEARANCE', from: 'ISSUED', to: 'PENDING_CLEARANCE', trigger: { kind: 'IMMEDIATE' }, description: 'submit to the authority via the outbox' },
        { on: 'CLEAR', from: 'PENDING_CLEARANCE', to: 'CLEARED', trigger: driver, description: 'authority authorises (UUID/folio/protocol)' },
        { on: 'REJECT', from: 'PENDING_CLEARANCE', to: 'REJECTED', trigger: driver, description: 'authority rejects → fix → re-issue as new doc' },
        { on: 'ENTER_CONTINGENCY', from: 'PENDING_CLEARANCE', to: 'CONTINGENCY', trigger: { kind: 'CONTINGENCY' }, description: 'authority down → offline issue (e.g. BR EPEC)' },
        { on: 'CLEAR', from: 'CONTINGENCY', to: 'CLEARED', trigger: driver, description: 'late submission accepted once the authority is back' },
      ],
    };
  }
}

/** Delivery to the buyer. Starts from CLEARED (blocking) or directly from ISSUED (non-blocking). */
export class DeliveryPhase implements PhaseContributor {
  readonly id = 'delivery';
  contributes(plan: CompliancePlan, pctx: PhaseContext): PhaseFragment {
    const from = plan.regime.blocking ? 'CLEARED' : 'ISSUED';
    // Already-cleared docs deliver immediately; otherwise the channel's feedback model decides
    // (email = IMMEDIATE, Peppol = CALLBACK confirmation, a polled portal = POLL).
    const driver = plan.regime.blocking
      ? ({ kind: 'IMMEDIATE' } as const)
      : triggerForFeedback(pctx.channelFeedback, { poll: pctx.pollPolicy, providerId: pctx.channelProviderId });
    return {
      states: ['DELIVERED'],
      transitions: [{ on: 'DELIVER', from, to: 'DELIVERED', trigger: driver, description: 'transmit to the recipient' }],
    };
  }
}

/** Bidirectional buyer/authority response track with optional silence = acceptance (CL/CO/FR). */
export class BuyerResponsePhase implements PhaseContributor {
  readonly id = 'buyer-response';
  contributes(plan: CompliancePlan): PhaseFragment | null {
    const resp = plan.lifecycle.response;
    if (!resp) return null;
    const accept =
      resp.defaultOnSilence === 'ACCEPT'
        ? ({ kind: 'TIMER', deadlineHours: resp.window?.hours, onElapse: 'ACCEPT' } as const)
        : ({ kind: 'CALLBACK' } as const);
    return {
      states: ['AWAITING_RESPONSE', 'ACCEPTED', 'REFUSED', 'DISPUTED'],
      transitions: [
        { on: 'OPEN_RESPONSE', from: 'DELIVERED', to: 'AWAITING_RESPONSE', trigger: { kind: 'IMMEDIATE' }, description: 'open the response window' },
        { on: 'ACCEPT', from: 'AWAITING_RESPONSE', to: 'ACCEPTED', trigger: accept, description: resp.defaultOnSilence === 'ACCEPT' ? 'buyer accept OR silence-timer elapses' : 'buyer/authority accept (status message)' },
        { on: 'REFUSE', from: 'AWAITING_RESPONSE', to: 'REFUSED', trigger: { kind: 'CALLBACK' }, description: 'buyer/authority refuse → correction path' },
        { on: 'DISPUTE', from: 'AWAITING_RESPONSE', to: 'DISPUTED', trigger: { kind: 'CALLBACK' }, description: 'buyer dispute (FR "en litige")' },
      ],
    };
  }
}

/** Periodic / real-time reporting side-effect, in parallel after delivery (or acceptance). */
export class ReportingPhase implements PhaseContributor {
  readonly id = 'reporting';
  contributes(plan: CompliancePlan): PhaseFragment | null {
    if (!plan.reporting || plan.reporting.length === 0) return null;
    const trigger =
      plan.regime.model === 'PERIODIC_REPORTING'
        ? ({ kind: 'TIMER', onElapse: 'REPORT' } as const) // filed on a period close
        : ({ kind: 'IMMEDIATE' } as const); // real-time / CTC e-reporting
    const transitions: PhaseFragment['transitions'] = [
      { on: 'REPORT', from: 'DELIVERED', to: 'REPORTED', trigger, description: `report: ${plan.reporting.join(', ')}` },
    ];
    if (plan.lifecycle.response) {
      transitions.push({ on: 'REPORT', from: 'ACCEPTED', to: 'REPORTED', trigger, description: 'report after acceptance' });
    }
    return { states: ['REPORTED'], transitions };
  }
}

/** Manual overlay: cancel (policy-gated) and correct-by-new-document, from wherever they are legal. */
export class CorrectionsPhase implements PhaseContributor {
  readonly id = 'corrections';
  contributes(plan: CompliancePlan): PhaseFragment {
    const lc = plan.lifecycle;
    const states: PhaseFragment['states'] = ['CANCELLED', 'CORRECTED'];
    const transitions: PhaseFragment['transitions'] = [];

    if (lc.cancellation?.allowed) {
      const guardKey = lc.cancellation.requiresBuyerConsent
        ? 'buyerConsent'
        : lc.cancellation.requiresAuthorityAck
          ? 'authorityAck'
          : undefined;
      if (plan.regime.blocking) {
        transitions.push({ on: 'CANCEL', from: 'CLEARED', to: 'CANCELLED', trigger: { kind: 'MANUAL', action: 'cancel' }, guardKey });
      }
      transitions.push({ on: 'CANCEL', from: 'DELIVERED', to: 'CANCELLED', trigger: { kind: 'MANUAL', action: 'cancel' }, guardKey });
    }

    // Correction is always a NEW document referencing the original (correctionModel decides the shape).
    transitions.push({ on: 'CORRECT', from: 'DELIVERED', to: 'CORRECTED', trigger: { kind: 'MANUAL', action: 'correct' }, description: lc.correctionModel });
    if (plan.lifecycle.response) {
      transitions.push({ on: 'CORRECT', from: 'ACCEPTED', to: 'CORRECTED', trigger: { kind: 'MANUAL', action: 'correct' } });
    }
    if (plan.reporting && plan.reporting.length > 0) {
      transitions.push({ on: 'CORRECT', from: 'REPORTED', to: 'CORRECTED', trigger: { kind: 'MANUAL', action: 'correct' } });
    }
    return { states, transitions };
  }
}
