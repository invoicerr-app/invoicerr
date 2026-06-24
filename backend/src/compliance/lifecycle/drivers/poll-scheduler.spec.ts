import { PartyRole, SupplyType } from '../../types';
import { PartyTaxProfile, TransactionContext } from '../../canonical/canonical-document';
import { resolve } from '../../engine/compliance-engine';
import { RecordingComplianceLogger } from '../../execution/logger';
import { TransmissionStatus } from '../../execution/types';
import { TransmissionProviderRegistry } from '../../providers/transmission/registry';
import { TransmissionProvider } from '../../providers/transmission/transmission-provider';
import { assembleFromPlan } from '../assembler';
import { LifecycleRuntime, LifecycleSignal } from '../runtime';
import { createPollJob, decidePoll, InMemoryPollJobStore, nextDelaySeconds, PollJob } from './poll-job';
import { PollScheduler, SchedulePollEffect } from './poll-scheduler';

const POLICY = { everySeconds: 30, timeoutHours: 24, backoff: 'EXPONENTIAL' as const };
const EFFECT: SchedulePollEffect = { kind: 'SCHEDULE_POLL', poll: POLICY, channelProviderId: 'pac', awaiting: 'PENDING_CLEARANCE' };

/** A controllable pollable provider standing in for a PAC/portal. */
function fakeRegistry() {
  let status: TransmissionStatus = 'PENDING';
  const provider: TransmissionProvider = {
    id: 'pac',
    channel: 'PAC',
    feedback: 'ASYNC_POLL',
    pollPolicy: POLICY,
    transmit: () => ({ channel: 'PAC', status: 'PENDING', notes: [] }),
    poll: () => ({ channel: 'PAC', status, notes: [] }),
  };
  return { reg: new TransmissionProviderRegistry([provider]), setStatus: (s: TransmissionStatus) => (status = s) };
}
function clockFrom(iso: string) {
  let d = new Date(iso);
  return { now: () => d, advance: (ms: number) => (d = new Date(d.getTime() + ms)) };
}

describe('poll-job — pure decision/backoff logic', () => {
  it('exponential backoff doubles per attempt and caps at 1h; linear is constant', () => {
    expect(nextDelaySeconds(POLICY, 0)).toBe(30);
    expect(nextDelaySeconds(POLICY, 1)).toBe(60);
    expect(nextDelaySeconds(POLICY, 5)).toBe(960);
    expect(nextDelaySeconds(POLICY, 20)).toBe(3600); // capped
    expect(nextDelaySeconds({ everySeconds: 45, timeoutHours: 1 }, 9)).toBe(45); // no backoff
  });

  it('decidePoll: resolves on CLEARED/REJECTED, reschedules while PENDING, expires past timeout', () => {
    const job = createPollJob({ id: 'j', documentId: 'd', providerId: 'pac', channel: 'PAC', awaiting: 'PENDING_CLEARANCE', policy: POLICY }, new Date('2027-01-15T00:00:00Z'));

    const cleared = decidePoll(job, 'CLEARED', new Date('2027-01-15T00:01:00Z'));
    expect(cleared).toMatchObject({ kind: 'RESOLVE', outcome: 'CLEARED' });
    expect(cleared.job.status).toBe('DONE');

    const again = decidePoll(job, 'PENDING', new Date('2027-01-15T00:01:00Z'));
    expect(again.kind).toBe('RESCHEDULE');
    expect(again.job.attempts).toBe(1);

    const expired = decidePoll(job, 'PENDING', new Date('2027-01-16T01:00:00Z')); // past 24h
    expect(expired.kind).toBe('EXPIRED');
    expect(expired.job.status).toBe('EXPIRED');
  });
});

describe('PollScheduler', () => {
  it('schedule() enqueues a PENDING job due after everySeconds, with provider/ref captured', async () => {
    const { reg } = fakeRegistry();
    const clock = clockFrom('2027-01-15T00:00:00Z');
    const store = new InMemoryPollJobStore();
    const scheduler = new PollScheduler({ applySignal: () => {}, store, txRegistry: reg, now: clock.now });

    const job = await scheduler.schedule('doc1', EFFECT, 'UUID-1');
    expect(job).toMatchObject({ status: 'PENDING', providerId: 'pac', channel: 'PAC', ref: 'UUID-1' });
    expect(new Date(job.nextRunAt).getTime()).toBe(clock.now().getTime() + 30_000);
  });

  it('tick(): a PENDING poll reschedules with backoff and emits no signal', async () => {
    const { reg, setStatus } = fakeRegistry();
    setStatus('PENDING');
    const clock = clockFrom('2027-01-15T00:00:00Z');
    const store = new InMemoryPollJobStore();
    const signals: Array<[string, LifecycleSignal]> = [];
    const scheduler = new PollScheduler({ applySignal: (id, s) => { signals.push([id, s]); }, store, txRegistry: reg, now: clock.now });

    await scheduler.schedule('doc1', EFFECT);
    clock.advance(31_000); // job becomes due
    const report = await scheduler.tick();

    expect(report).toMatchObject({ due: 1, polled: 1, rescheduled: 1, resolved: 0 });
    expect(signals).toHaveLength(0);
    expect((await store.forDocument('doc1'))[0].attempts).toBe(1);
  });

  it('tick(): a CLEARED poll marks the job DONE and feeds POLL_RESULT back to the runtime', async () => {
    const { reg, setStatus } = fakeRegistry();
    setStatus('CLEARED');
    const clock = clockFrom('2027-01-15T00:00:00Z');
    const store = new InMemoryPollJobStore();
    const signals: Array<[string, LifecycleSignal]> = [];
    const scheduler = new PollScheduler({ applySignal: (id, s) => { signals.push([id, s]); }, store, txRegistry: reg, now: clock.now });

    await scheduler.schedule('doc1', EFFECT);
    clock.advance(31_000);
    const report = await scheduler.tick();

    expect(report).toMatchObject({ resolved: 1, rescheduled: 0 });
    expect(signals).toEqual([['doc1', { type: 'POLL_RESULT', status: 'CLEARED' }]]);
    expect((await store.forDocument('doc1'))[0].status).toBe('DONE');
  });

  it('tick(): a job past its timeout expires and calls onExpire', async () => {
    const { reg, setStatus } = fakeRegistry();
    setStatus('PENDING');
    const clock = clockFrom('2027-01-15T00:00:00Z');
    const store = new InMemoryPollJobStore();
    const expired: PollJob[] = [];
    const scheduler = new PollScheduler({ applySignal: () => {}, store, txRegistry: reg, now: clock.now, onExpire: (j) => expired.push(j) });

    await scheduler.schedule('doc1', EFFECT); // expiresAt = +24h
    clock.advance(25 * 3_600_000); // past timeout (and due)
    const report = await scheduler.tick();

    expect(report.expired).toBe(1);
    expect(expired).toHaveLength(1);
    expect((await store.forDocument('doc1'))[0].status).toBe('EXPIRED');
  });
});

describe('PollScheduler × LifecycleRuntime — end-to-end clearance (MX)', () => {
  function party(country: string, role: PartyRole): PartyTaxProfile {
    return { legalName: `${country} Co`, countryCode: country, role, identifiers: [{ scheme: 'VAT', value: `${country}1`, validated: true }] };
  }
  function tx(s: string, b: string, role: PartyRole, supply: SupplyType, date: string): TransactionContext {
    return { supplier: party(s, 'B2B'), buyer: party(b, role), lines: [{ id: 'l1', description: 'x', quantity: 1, unitNetMinor: 10000, supplyType: supply }], issueDate: new Date(date), currency: 'EUR' };
  }

  it('SUBMIT_CLEARANCE arms a poll; a polled CLEARED drives PENDING_CLEARANCE → CLEARED', async () => {
    const graph = assembleFromPlan(resolve(tx('MX', 'MX', 'B2B', 'GOODS', '2027-01-15')));
    const runtime = new LifecycleRuntime(graph, 'ISSUED', new RecordingComplianceLogger());

    // Entering PENDING_CLEARANCE arms exactly one poll (CLEAR/REJECT share the driver).
    const effects = runtime.dispatch({ type: 'COMMAND', event: 'SUBMIT_CLEARANCE' });
    expect(runtime.status).toBe('PENDING_CLEARANCE');
    const polls = effects.filter((e) => e.kind === 'SCHEDULE_POLL');
    expect(polls).toHaveLength(1);
    const sp = polls[0];
    if (sp.kind !== 'SCHEDULE_POLL') throw new Error('expected SCHEDULE_POLL');
    expect(sp.channelProviderId).toBe('pac');

    const { reg, setStatus } = fakeRegistry();
    setStatus('CLEARED');
    const clock = clockFrom('2027-01-15T00:00:00Z');
    const scheduler = new PollScheduler({
      applySignal: (_id, signal) => { runtime.dispatch(signal); }, // feed the outcome back into the runtime
      store: new InMemoryPollJobStore(),
      txRegistry: reg,
      now: clock.now,
    });

    await scheduler.schedule('mx-doc', sp, 'UUID-123');
    clock.advance(60_000); // make the job due
    await scheduler.tick();

    expect(runtime.status).toBe('CLEARED');
  });
});