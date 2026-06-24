import { CompliancePlan } from '../../engine/compliance-engine';
import { LifecyclePolicy } from '../../profiles/schema';
import {
  BuyerResponsePhase,
  ClearancePhase,
  CorrectionsPhase,
  DeliveryPhase,
  IssuancePhase,
  ReportingPhase,
} from './contributors';
import { PhaseContext, PhaseContributor } from './phase-contributor';

function plan(over: Partial<CompliancePlan> = {}): CompliancePlan {
  const lifecycle: LifecyclePolicy = { immutableAfter: 'ISSUE', correctionModel: 'CREDIT_NOTE', cancellation: { allowed: true, requiresAuthorityAck: false } };
  return {
    supplier: { country: 'XX', confidence: 'OFFICIAL' },
    buyer: { country: 'XX', confidence: 'OFFICIAL' },
    classification: { buyerRole: 'B2B', crossBorder: false, supplyTypes: ['GOODS'] },
    tax: { lines: [], reportingFlags: [], mentions: [], buyerSelfAssess: false },
    taxSystemKind: 'VAT',
    regime: { model: 'POST_AUDIT', blocking: false },
    artifacts: [],
    channels: [],
    numbering: { model: 'GAPLESS_SELF' },
    lifecycle,
    archival: { retentionYears: 10, archivedForm: 'HYBRID_PDF', integrity: 'NONE' },
    reporting: [],
    confidence: 'OFFICIAL',
    warnings: [],
    ...over,
  };
}
const ctx: PhaseContext = {};
const get = (c: PhaseContributor, p: CompliancePlan, pc: PhaseContext = ctx) => c.contributes(p, pc);

describe('phase contributors — gating & drivers', () => {
  it('Issuance always contributes DRAFT → ISSUED', () => {
    const f = get(new IssuancePhase(), plan())!;
    expect(f.states).toEqual(expect.arrayContaining(['DRAFT', 'ISSUED']));
    expect(f.transitions[0]).toMatchObject({ on: 'ISSUE', from: 'DRAFT', to: 'ISSUED' });
  });

  it('Clearance contributes only when the regime is blocking', () => {
    expect(get(new ClearancePhase(), plan())).toBeNull();
    const f = get(new ClearancePhase(), plan({ regime: { model: 'CLEARANCE', blocking: true } }), { channelFeedback: 'ASYNC_POLL', pollPolicy: { everySeconds: 30, timeoutHours: 24 } })!;
    expect(f.states).toEqual(expect.arrayContaining(['PENDING_CLEARANCE', 'CLEARED', 'REJECTED', 'CONTINGENCY']));
    expect(f.transitions.find((t) => t.on === 'CLEAR')!.trigger.kind).toBe('POLL');
  });

  it('Clearance binds a CALLBACK driver when the channel pushes statuses', () => {
    const f = get(new ClearancePhase(), plan({ regime: { model: 'CLEARANCE', blocking: true } }), { channelFeedback: 'ASYNC_CALLBACK' })!;
    expect(f.transitions.find((t) => t.on === 'CLEAR')!.trigger.kind).toBe('CALLBACK');
  });

  it('Delivery starts from CLEARED when blocking, ISSUED otherwise', () => {
    expect(get(new DeliveryPhase(), plan({ regime: { model: 'CLEARANCE', blocking: true } }))!.transitions[0].from).toBe('CLEARED');
    const nonBlocking = get(new DeliveryPhase(), plan(), { channelFeedback: 'NONE' })!;
    expect(nonBlocking.transitions[0].from).toBe('ISSUED');
    expect(nonBlocking.transitions[0].trigger.kind).toBe('IMMEDIATE');
  });

  it('BuyerResponse contributes only with a response policy; silence=ACCEPT → TIMER', () => {
    expect(get(new BuyerResponsePhase(), plan())).toBeNull();
    const withResp = plan({ lifecycle: { ...plan().lifecycle, response: { window: { hours: 192 }, defaultOnSilence: 'ACCEPT' } } });
    const accept = get(new BuyerResponsePhase(), withResp)!.transitions.find((t) => t.on === 'ACCEPT')!;
    expect(accept.trigger.kind).toBe('TIMER');
    if (accept.trigger.kind === 'TIMER') expect(accept.trigger.deadlineHours).toBe(192);
  });

  it('BuyerResponse with silence=NONE accepts via CALLBACK', () => {
    const withResp = plan({ lifecycle: { ...plan().lifecycle, response: { defaultOnSilence: 'NONE' } } });
    const accept = get(new BuyerResponsePhase(), withResp)!.transitions.find((t) => t.on === 'ACCEPT')!;
    expect(accept.trigger.kind).toBe('CALLBACK');
  });

  it('Reporting contributes only when there are reporting kinds', () => {
    expect(get(new ReportingPhase(), plan())).toBeNull();
    expect(get(new ReportingPhase(), plan({ reporting: ['OSS'] }))!.states).toContain('REPORTED');
  });

  it('Corrections: cancel guard reflects buyer consent', () => {
    const p = plan({ regime: { model: 'CLEARANCE', blocking: true }, lifecycle: { immutableAfter: 'CLEARANCE', correctionModel: 'CREDIT_NOTE', cancellation: { allowed: true, requiresAuthorityAck: true, requiresBuyerConsent: true } } });
    const cancel = get(new CorrectionsPhase(), p)!.transitions.find((t) => t.on === 'CANCEL' && t.from === 'CLEARED')!;
    expect(cancel.guardKey).toBe('buyerConsent');
  });

  it('Corrections: no cancel transition when cancellation is disallowed', () => {
    const p = plan({ lifecycle: { ...plan().lifecycle, cancellation: { allowed: false, requiresAuthorityAck: false } } });
    expect(get(new CorrectionsPhase(), p)!.transitions.some((t) => t.on === 'CANCEL')).toBe(false);
  });
});
