import { PartyRole, SupplyType } from '../types';
import { PartyTaxProfile, TransactionContext } from '../canonical/canonical-document';
import { resolve } from '../engine/compliance-engine';
import { RecordingComplianceLogger } from '../execution/logger';
import { assembleFromPlan } from './assembler';
import { LifecycleRuntime } from './runtime';

function party(country: string, role: PartyRole): PartyTaxProfile {
  return { legalName: `${country} Co`, countryCode: country, role, identifiers: [{ scheme: 'VAT', value: `${country}1`, validated: true }] };
}
function tx(supplier: string, buyer: string, role: PartyRole, supply: SupplyType, date: string): TransactionContext {
  return {
    supplier: party(supplier, 'B2B'),
    buyer: party(buyer, role),
    lines: [{ id: 'l1', description: 'x', quantity: 1, unitNetMinor: 10000, supplyType: supply }],
    issueDate: new Date(date),
    currency: 'EUR',
  };
}
const graphOf = (s: string, b: string, r: PartyRole, sup: SupplyType, d: string) => assembleFromPlan(resolve(tx(s, b, r, sup, d)));
const findOn = (g: ReturnType<typeof assembleFromPlan>, on: string) => g.transitions.find((t) => t.on === on);

describe('Lifecycle assembly — composed per (issuer, recipient, channel)', () => {
  it('FR→FR B2B (PDP, callback, non-blocking): buyer-response track, NO clearance, delivery driven by CALLBACK', () => {
    const g = graphOf('FR', 'FR', 'B2B', 'SERVICES', '2027-01-15');
    expect(g.states).toContain('AWAITING_RESPONSE');
    expect(g.states).not.toContain('PENDING_CLEARANCE');
    expect(findOn(g, 'DELIVER')!.trigger.kind).toBe('CALLBACK'); // PDP feedback = ASYNC_CALLBACK
    expect(findOn(g, 'ACCEPT')!.trigger.kind).toBe('CALLBACK'); // FR defaultOnSilence = NONE
  });

  it('MX→MX B2B (PAC, poll, blocking): clearance phase, CLEAR driven by POLL, cancel needs buyer consent', () => {
    const g = graphOf('MX', 'MX', 'B2B', 'GOODS', '2027-01-15');
    expect(g.states).toEqual(expect.arrayContaining(['PENDING_CLEARANCE', 'CLEARED']));
    expect(findOn(g, 'CLEAR')!.trigger.kind).toBe('POLL'); // PAC feedback = ASYNC_POLL
    expect(findOn(g, 'DELIVER')!.trigger.kind).toBe('IMMEDIATE'); // already cleared → immediate
    const cancel = g.transitions.find((t) => t.on === 'CANCEL' && t.from === 'CLEARED');
    expect(cancel!.guardKey).toBe('buyerConsent');
  });

  it('US→FR B2B (email, none, non-blocking): no clearance, no response, delivery IMMEDIATE from ISSUED', () => {
    const g = graphOf('US', 'FR', 'B2B', 'SERVICES', '2027-01-15');
    expect(g.states).not.toContain('PENDING_CLEARANCE');
    expect(g.states).not.toContain('AWAITING_RESPONSE');
    const deliver = findOn(g, 'DELIVER')!;
    expect(deliver.from).toBe('ISSUED');
    expect(deliver.trigger.kind).toBe('IMMEDIATE'); // email feedback = NONE
  });
});

describe('Lifecycle runtime — event-sourced interpretation', () => {
  it('MX: a POLL_RESULT(CLEARED) advances PENDING_CLEARANCE → CLEARED and arms the manual cancel action', () => {
    const g = graphOf('MX', 'MX', 'B2B', 'GOODS', '2027-01-15');
    const rt = new LifecycleRuntime(g, 'PENDING_CLEARANCE', new RecordingComplianceLogger());
    expect(rt.pendingDrivers().some((t) => t.kind === 'POLL')).toBe(true);

    const effects = rt.dispatch({ type: 'POLL_RESULT', status: 'CLEARED' });
    expect(rt.status).toBe('CLEARED');
    expect(effects).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'APPLIED', to: 'CLEARED' })]));
    expect(rt.availableActions().some((t) => t.trigger.kind === 'MANUAL' && (t.trigger as { action: string }).action === 'cancel')).toBe(true);
  });

  it('immutability: an illegal COMMAND throws', () => {
    const g = graphOf('US', 'FR', 'B2B', 'SERVICES', '2027-01-15');
    const rt = new LifecycleRuntime(g, 'DELIVERED', new RecordingComplianceLogger());
    expect(() => rt.dispatch({ type: 'COMMAND', event: 'CLEAR' })).toThrow(/Illegal action/);
  });
});
