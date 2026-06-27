import { ComplianceStateMachine } from './state-machine';

describe('ComplianceStateMachine', () => {
  it('allows free editing only in DRAFT', () => {
    const sm = new ComplianceStateMachine();
    expect(sm.canEdit()).toBe(true);
    sm.apply('ISSUE');
    expect(sm.status).toBe('ISSUED');
    expect(sm.canEdit()).toBe(false);
  });

  it('walks the clearance path: ISSUED → PENDING_CLEARANCE → CLEARED → DELIVERED', () => {
    const sm = new ComplianceStateMachine('ISSUED');
    sm.apply('SUBMIT_CLEARANCE');
    expect(sm.status).toBe('PENDING_CLEARANCE');
    sm.apply('CLEAR');
    expect(sm.status).toBe('CLEARED');
    sm.apply('DELIVER');
    expect(sm.status).toBe('DELIVERED');
  });

  it('walks the bidirectional response path with silence handled elsewhere', () => {
    const sm = new ComplianceStateMachine('DELIVERED');
    sm.apply('OPEN_RESPONSE');
    expect(sm.status).toBe('AWAITING_RESPONSE');
    sm.apply('REFUSE');
    expect(sm.status).toBe('REFUSED');
    sm.apply('CORRECT');
    expect(sm.status).toBe('CORRECTED');
    expect(sm.isTerminal()).toBe(true);
  });

  it('throws on an illegal transition', () => {
    const sm = new ComplianceStateMachine('DRAFT');
    expect(() => sm.apply('CLEAR')).toThrow(/Illegal transition/);
  });

  it('reports whether an event is allowed without applying it', () => {
    const sm = new ComplianceStateMachine('CLEARED');
    expect(sm.can('CANCEL')).toBe(true);
    expect(sm.can('ISSUE')).toBe(false);
  });
});
