import { PartyRole, SupplyType } from '../../types';
import { PartyTaxProfile, TransactionContext } from '../../canonical/canonical-document';
import { resolve } from '../../engine/compliance-engine';
import { RecordingComplianceLogger } from '../../execution/logger';
import { assembleFromPlan } from '../assembler';
import { LifecycleRuntime, LifecycleSignal } from '../runtime';
import { InMemoryCallbackStore } from './inbound-job';
import { AwaitCallbackEffect, InboundRouter } from './inbound-router';

const AWAIT: AwaitCallbackEffect = { kind: 'AWAIT_CALLBACK', awaiting: 'PENDING_CLEARANCE' };

describe('InboundRouter — register / receive / dedup / correlate', () => {
  it('register() records a WAITING registration', () => {
    const store = new InMemoryCallbackStore();
    const router = new InboundRouter({ applySignal: () => {}, store });
    const reg = router.register('doc1', AWAIT, { channel: 'SDI', correlationKey: 'ref1' });
    expect(reg).toMatchObject({ documentId: 'doc1', channel: 'SDI', correlationKey: 'ref1', status: 'WAITING' });
  });

  it('routes a matching inbound message into the document runtime as INBOUND_STATUS', () => {
    const store = new InMemoryCallbackStore();
    const calls: Array<[string, LifecycleSignal]> = [];
    const router = new InboundRouter({ applySignal: (id, s) => calls.push([id, s]), store });
    router.register('doc1', AWAIT, { channel: 'SDI', correlationKey: 'ref1' });

    const res = router.receive({ channel: 'SDI', correlationKey: 'ref1', status: 'consegnata', rawRef: 'm1' });
    expect(res).toEqual({ kind: 'ROUTED', documentId: 'doc1', signal: { type: 'INBOUND_STATUS', status: 'consegnata' } });
    expect(calls).toEqual([['doc1', { type: 'INBOUND_STATUS', status: 'consegnata' }]]);
  });

  it('drops a duplicate (same provider ref) without re-applying', () => {
    const store = new InMemoryCallbackStore();
    const calls: Array<[string, LifecycleSignal]> = [];
    const router = new InboundRouter({ applySignal: (id, s) => calls.push([id, s]), store });
    router.register('doc1', AWAIT, { channel: 'SDI', correlationKey: 'ref1' });

    router.receive({ channel: 'SDI', correlationKey: 'ref1', status: 'consegnata', rawRef: 'm1' });
    const dup = router.receive({ channel: 'SDI', correlationKey: 'ref1', status: 'consegnata', rawRef: 'm1' });
    expect(dup).toEqual({ kind: 'DUPLICATE' });
    expect(calls).toHaveLength(1);
  });

  it('reports UNMATCHED when no registration correlates', () => {
    const router = new InboundRouter({ applySignal: () => {}, store: new InMemoryCallbackStore() });
    router.register('doc1', AWAIT, { channel: 'SDI', correlationKey: 'ref1' });
    const res = router.receive({ channel: 'SDI', correlationKey: 'other', status: 'consegnata', rawRef: 'm9' });
    expect(res).toEqual({ kind: 'UNMATCHED', correlationKey: 'other' });
  });
});

describe('InboundRouter × LifecycleRuntime — pushed statuses drive the lifecycle', () => {
  function party(country: string, role: PartyRole): PartyTaxProfile {
    return { legalName: `${country} Co`, countryCode: country, role, identifiers: [{ scheme: 'VAT', value: `${country}1`, validated: true }] };
  }
  function tx(s: string, b: string, role: PartyRole, supply: SupplyType, date: string): TransactionContext {
    return { supplier: party(s, 'B2B'), buyer: party(b, role), lines: [{ id: 'l1', description: 'x', quantity: 1, unitNetMinor: 10000, supplyType: supply }], issueDate: new Date(date), currency: 'EUR' };
  }
  const graphOf = (s: string, b: string, sup: SupplyType, d: string) => assembleFromPlan(resolve(tx(s, b, 'B2B', sup, d)));

  it('IT (SdI, callback): an authority "consegnata" push drives PENDING_CLEARANCE → CLEARED', () => {
    const runtime = new LifecycleRuntime(graphOf('IT', 'IT', 'GOODS', '2027-01-15'), 'ISSUED', new RecordingComplianceLogger());
    const effects = runtime.dispatch({ type: 'COMMAND', event: 'SUBMIT_CLEARANCE' });
    expect(runtime.status).toBe('PENDING_CLEARANCE');
    const awaitCb = effects.find((e) => e.kind === 'AWAIT_CALLBACK');
    if (awaitCb?.kind !== 'AWAIT_CALLBACK') throw new Error('expected AWAIT_CALLBACK');

    const router = new InboundRouter({ applySignal: (_id, s) => runtime.dispatch(s) });
    router.register('it-doc', awaitCb, { channel: 'SDI', correlationKey: 'sdi-1' });
    router.receive({ channel: 'SDI', correlationKey: 'sdi-1', status: 'notifica - consegnata', rawRef: 'sdi-msg-1' });

    expect(runtime.status).toBe('CLEARED');
  });

  it('FR (PDP, callback): an "approuvée" push drives AWAITING_RESPONSE → ACCEPTED', () => {
    const runtime = new LifecycleRuntime(graphOf('FR', 'FR', 'SERVICES', '2027-01-15'), 'DELIVERED', new RecordingComplianceLogger());
    const effects = runtime.dispatch({ type: 'COMMAND', event: 'OPEN_RESPONSE' });
    expect(runtime.status).toBe('AWAITING_RESPONSE');
    const awaitCb = effects.find((e) => e.kind === 'AWAIT_CALLBACK');
    if (awaitCb?.kind !== 'AWAIT_CALLBACK') throw new Error('expected AWAIT_CALLBACK');

    const router = new InboundRouter({ applySignal: (_id, s) => runtime.dispatch(s) });
    router.register('fr-doc', awaitCb, { channel: 'PDP', correlationKey: 'pdp-1' });
    router.receive({ channel: 'PDP', correlationKey: 'pdp-1', status: 'approuvée', rawRef: 'pdp-msg-1' });

    expect(runtime.status).toBe('ACCEPTED');
  });

  it('FR (PDP, callback): a "refusée" push drives AWAITING_RESPONSE → REFUSED', () => {
    const runtime = new LifecycleRuntime(graphOf('FR', 'FR', 'SERVICES', '2027-01-15'), 'AWAITING_RESPONSE', new RecordingComplianceLogger());
    const router = new InboundRouter({ applySignal: (_id, s) => runtime.dispatch(s) });
    router.register('fr-doc', { kind: 'AWAIT_CALLBACK', awaiting: 'AWAITING_RESPONSE' }, { channel: 'PDP', correlationKey: 'pdp-2' });
    router.receive({ channel: 'PDP', correlationKey: 'pdp-2', status: 'refusée', rawRef: 'pdp-msg-2' });
    expect(runtime.status).toBe('REFUSED');
  });
});
