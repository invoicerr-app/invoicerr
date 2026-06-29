import { RecordingComplianceLogger } from '../execution/logger';
import { LifecycleGraph } from './assembler';
import { LifecycleRuntime } from './runtime';

const POLL = { everySeconds: 30, timeoutHours: 24 } as const;

const graph: LifecycleGraph = {
  initial: 'DRAFT',
  states: ['ISSUED', 'PENDING_CLEARANCE', 'CLEARED', 'REJECTED', 'DELIVERED', 'AWAITING_RESPONSE', 'ACCEPTED', 'REFUSED', 'DISPUTED', 'CANCELLED'],
  transitions: [
    { on: 'SUBMIT_CLEARANCE', from: 'ISSUED', to: 'PENDING_CLEARANCE', trigger: { kind: 'IMMEDIATE' } },
    { on: 'CLEAR', from: 'PENDING_CLEARANCE', to: 'CLEARED', trigger: { kind: 'POLL', poll: POLL } },
    { on: 'REJECT', from: 'PENDING_CLEARANCE', to: 'REJECTED', trigger: { kind: 'POLL', poll: POLL } },
    { on: 'CANCEL', from: 'CLEARED', to: 'CANCELLED', trigger: { kind: 'MANUAL', action: 'cancel' }, guardKey: 'buyerConsent' },
    { on: 'OPEN_RESPONSE', from: 'DELIVERED', to: 'AWAITING_RESPONSE', trigger: { kind: 'IMMEDIATE' } },
    { on: 'ACCEPT', from: 'AWAITING_RESPONSE', to: 'ACCEPTED', trigger: { kind: 'TIMER', deadlineHours: 192, onElapse: 'ACCEPT' } },
    { on: 'REFUSE', from: 'AWAITING_RESPONSE', to: 'REFUSED', trigger: { kind: 'CALLBACK' } },
    { on: 'DISPUTE', from: 'AWAITING_RESPONSE', to: 'DISPUTED', trigger: { kind: 'CALLBACK' } },
  ],
};

describe('LifecycleRuntime — projections', () => {
  it('availableActions returns only MANUAL transitions from the current state', () => {
    const r = new LifecycleRuntime(graph, 'CLEARED', new RecordingComplianceLogger());
    expect(r.availableActions().map((t) => t.on)).toEqual(['CANCEL']);
  });
  it('pendingDrivers returns the armed non-manual triggers', () => {
    const r = new LifecycleRuntime(graph, 'PENDING_CLEARANCE', new RecordingComplianceLogger());
    expect(r.pendingDrivers().map((t) => t.kind)).toContain('POLL');
    expect(new LifecycleRuntime(graph, 'CLEARED', new RecordingComplianceLogger()).pendingDrivers()).toHaveLength(0);
  });
});

describe('LifecycleRuntime — dispatch', () => {
  it('an illegal COMMAND throws (immutability guard)', () => {
    const r = new LifecycleRuntime(graph, 'CLEARED', new RecordingComplianceLogger());
    expect(() => r.dispatch({ type: 'COMMAND', event: 'CLEAR' })).toThrow(/Illegal action/);
  });

  it('an async signal that does not apply in the current state is a safe NOOP', () => {
    const r = new LifecycleRuntime(graph, 'CLEARED', new RecordingComplianceLogger());
    expect(r.dispatch({ type: 'TIMER_ELAPSED' })).toEqual([{ kind: 'NOOP', reason: expect.any(String) }]);
    expect(r.status).toBe('CLEARED');
  });

  it('AUTHORITY_ACK maps to CLEAR / REJECT', () => {
    const ok = new LifecycleRuntime(graph, 'PENDING_CLEARANCE', new RecordingComplianceLogger());
    ok.dispatch({ type: 'AUTHORITY_ACK', cleared: true });
    expect(ok.status).toBe('CLEARED');
    const ko = new LifecycleRuntime(graph, 'PENDING_CLEARANCE', new RecordingComplianceLogger());
    ko.dispatch({ type: 'AUTHORITY_ACK', cleared: false });
    expect(ko.status).toBe('REJECTED');
  });

  it('POLL_RESULT PENDING is a NOOP; CLEARED advances', () => {
    const r = new LifecycleRuntime(graph, 'PENDING_CLEARANCE', new RecordingComplianceLogger());
    expect(r.dispatch({ type: 'POLL_RESULT', status: 'PENDING' })[0].kind).toBe('NOOP');
    expect(r.status).toBe('PENDING_CLEARANCE');
    r.dispatch({ type: 'POLL_RESULT', status: 'CLEARED' });
    expect(r.status).toBe('CLEARED');
  });

  it('TIMER_ELAPSED resolves to the TIMER transition onElapse (silence = acceptance)', () => {
    const r = new LifecycleRuntime(graph, 'AWAITING_RESPONSE', new RecordingComplianceLogger());
    r.dispatch({ type: 'TIMER_ELAPSED' });
    expect(r.status).toBe('ACCEPTED');
  });

  it('entering a state with two polled edges arms exactly ONE poll (dedup)', () => {
    const r = new LifecycleRuntime(graph, 'ISSUED', new RecordingComplianceLogger());
    const effects = r.dispatch({ type: 'COMMAND', event: 'SUBMIT_CLEARANCE' });
    expect(effects.filter((e) => e.kind === 'SCHEDULE_POLL')).toHaveLength(1);
  });
});

describe('LifecycleRuntime — inbound status mapping', () => {
  it('clearance-phase callbacks map authorize/reject words', () => {
    const a = new LifecycleRuntime(graph, 'PENDING_CLEARANCE', new RecordingComplianceLogger());
    a.dispatch({ type: 'INBOUND_STATUS', status: 'autorizado' });
    expect(a.status).toBe('CLEARED');
    const b = new LifecycleRuntime(graph, 'PENDING_CLEARANCE', new RecordingComplianceLogger());
    b.dispatch({ type: 'INBOUND_STATUS', status: 'rechazo' });
    expect(b.status).toBe('REJECTED');
  });

  it('response-phase callbacks map accept / refuse / dispute words', () => {
    const acc = new LifecycleRuntime(graph, 'AWAITING_RESPONSE', new RecordingComplianceLogger());
    acc.dispatch({ type: 'INBOUND_STATUS', status: 'approuvée' });
    expect(acc.status).toBe('ACCEPTED');
    const ref = new LifecycleRuntime(graph, 'AWAITING_RESPONSE', new RecordingComplianceLogger());
    ref.dispatch({ type: 'INBOUND_STATUS', status: 'refusée' });
    expect(ref.status).toBe('REFUSED');
    const dis = new LifecycleRuntime(graph, 'AWAITING_RESPONSE', new RecordingComplianceLogger());
    dis.dispatch({ type: 'INBOUND_STATUS', status: 'en litige' });
    expect(dis.status).toBe('DISPUTED');
  });

  it('an unrecognised inbound status is a NOOP and logs a TODO', () => {
    const log = new RecordingComplianceLogger();
    const r = new LifecycleRuntime(graph, 'AWAITING_RESPONSE', log);
    expect(r.dispatch({ type: 'INBOUND_STATUS', status: 'blah blah' })[0].kind).toBe('NOOP');
    expect(r.status).toBe('AWAITING_RESPONSE');
    expect(log.hasScope('lifecycle/runtime')).toBe(true);
  });
});
