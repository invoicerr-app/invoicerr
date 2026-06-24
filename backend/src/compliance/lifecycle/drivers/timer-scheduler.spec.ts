import { PartyRole, SupplyType } from '../../types';
import { PartyTaxProfile, TransactionContext } from '../../canonical/canonical-document';
import { resolve } from '../../engine/compliance-engine';
import { RecordingComplianceLogger } from '../../execution/logger';
import { assembleFromPlan } from '../assembler';
import { LifecycleRuntime, LifecycleSignal } from '../runtime';
import { createTimerJob, InMemoryTimerJobStore } from './timer-job';
import { ArmTimerEffect, TimerScheduler } from './timer-scheduler';

function clockFrom(iso: string) {
  let d = new Date(iso);
  return { now: () => d, advance: (ms: number) => (d = new Date(d.getTime() + ms)) };
}
const HOURS = 3_600_000;

describe('timer-job — pure', () => {
  it('createTimerJob sets fireAt = now + deadlineHours and status ARMED', () => {
    const job = createTimerJob(
      { id: 't1', documentId: 'd', awaiting: 'AWAITING_RESPONSE', onElapse: 'ACCEPT', deadlineHours: 192 },
      new Date('2027-01-15T00:00:00Z'),
    );
    expect(job.status).toBe('ARMED');
    expect(new Date(job.fireAt).getTime()).toBe(new Date('2027-01-15T00:00:00Z').getTime() + 192 * HOURS);
  });
});

describe('TimerScheduler', () => {
  const ARM: ArmTimerEffect = { kind: 'ARM_TIMER', deadlineHours: 192, onElapse: 'ACCEPT', awaiting: 'AWAITING_RESPONSE' };

  it('arm() returns null for an open-ended window (no deadline)', async () => {
    const scheduler = new TimerScheduler({ applySignal: () => {}, store: new InMemoryTimerJobStore() });
    const openEnded: ArmTimerEffect = { kind: 'ARM_TIMER', onElapse: 'ACCEPT', awaiting: 'AWAITING_RESPONSE' };
    expect(await scheduler.arm('doc1', openEnded)).toBeNull();
  });

  it('tick() fires only once the deadline elapses, emitting TIMER_ELAPSED', async () => {
    const clock = clockFrom('2027-01-15T00:00:00Z');
    const store = new InMemoryTimerJobStore();
    const signals: Array<[string, LifecycleSignal]> = [];
    const scheduler = new TimerScheduler({ applySignal: (id, s) => { signals.push([id, s]); }, store, now: clock.now });

    await scheduler.arm('doc1', ARM);
    expect(await scheduler.tick()).toMatchObject({ due: 0, fired: 0 }); // not yet
    expect(signals).toHaveLength(0);

    clock.advance(192 * HOURS + 1000); // past the 8-day deadline
    expect(await scheduler.tick()).toMatchObject({ due: 1, fired: 1 });
    expect(signals).toEqual([['doc1', { type: 'TIMER_ELAPSED' }]]);
    expect((await store.forDocument('doc1'))[0].status).toBe('FIRED');
  });
});

describe('TimerScheduler × LifecycleRuntime — Chile silence = acceptance (8 days)', () => {
  function party(country: string, role: PartyRole): PartyTaxProfile {
    return { legalName: `${country} Co`, countryCode: country, role, identifiers: [{ scheme: 'VAT', value: `${country}1`, validated: true }] };
  }
  function tx(s: string, b: string, role: PartyRole, supply: SupplyType, date: string): TransactionContext {
    return { supplier: party(s, 'B2B'), buyer: party(b, role), lines: [{ id: 'l1', description: 'x', quantity: 1, unitNetMinor: 10000, supplyType: supply }], issueDate: new Date(date), currency: 'EUR' };
  }
  const clGraph = () => assembleFromPlan(resolve(tx('CL', 'CL', 'B2B', 'GOODS', '2027-01-15')));

  it('opening the response window arms an 8-day timer whose elapse drives AWAITING_RESPONSE → ACCEPTED', async () => {
    const runtime = new LifecycleRuntime(clGraph(), 'DELIVERED', new RecordingComplianceLogger());

    const effects = runtime.dispatch({ type: 'COMMAND', event: 'OPEN_RESPONSE' });
    expect(runtime.status).toBe('AWAITING_RESPONSE');
    const arm = effects.find((e) => e.kind === 'ARM_TIMER');
    if (arm?.kind !== 'ARM_TIMER') throw new Error('expected ARM_TIMER');
    expect(arm.deadlineHours).toBe(192);
    expect(arm.onElapse).toBe('ACCEPT');

    const clock = clockFrom('2027-01-15T00:00:00Z');
    const scheduler = new TimerScheduler({ applySignal: (_id, s) => { runtime.dispatch(s); }, store: new InMemoryTimerJobStore(), now: clock.now });
    await scheduler.arm('cl-doc', arm);

    clock.advance(192 * HOURS + 1); // 8 days of silence
    await scheduler.tick();
    expect(runtime.status).toBe('ACCEPTED');
  });

  it('a buyer rejection before the deadline wins; a later (stale) timer fire is a safe no-op', () => {
    const runtime = new LifecycleRuntime(clGraph(), 'AWAITING_RESPONSE', new RecordingComplianceLogger());

    runtime.dispatch({ type: 'INBOUND_STATUS', status: 'rechazo' }); // SII "rechazo" → REFUSE
    expect(runtime.status).toBe('REFUSED');

    // The scheduler later fires the now-stale timer: the runtime finds no TIMER edge from REFUSED.
    const effects = runtime.dispatch({ type: 'TIMER_ELAPSED' });
    expect(effects).toEqual([{ kind: 'NOOP', reason: expect.any(String) }]);
    expect(runtime.status).toBe('REFUSED');
  });
});
