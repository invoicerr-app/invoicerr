import { vi } from 'vitest';

import { Queue } from 'bullmq';

import { ConfiguredRepeatable, retireSupersededRepeatables } from './queue-repeatables';

/**
 * A fake queue that reproduces the ONE BullMQ behaviour this helper exists to compensate for: a
 * repeatable definition is stored under a key derived from its own schedule, so `add`-ing the same
 * job name under a DIFFERENT cron/interval leaves the previous definition in place instead of
 * replacing it. No Redis — the same "fake Queue, real decision" split
 * `modules/documents/queue/document-queue.dispatcher.spec.ts` already uses for this class of test.
 */
function fakeQueue(name = 'test-queue') {
  const schedulers = new Map<string, Record<string, unknown>>();
  const queue = {
    name,
    add: vi.fn(
      async (jobName: string, _data: unknown, opts: { jobId?: string; repeat?: Record<string, unknown> }) => {
        if (!opts?.repeat) return;
        const { pattern, every, tz } = opts.repeat as { pattern?: string; every?: number; tz?: string };
        const key = `${jobName}:${opts.jobId ?? ''}::${tz ?? ''}:${pattern ?? every}`;
        schedulers.set(key, {
          key,
          name: jobName,
          ...(pattern === undefined ? {} : { pattern }),
          ...(every === undefined ? {} : { every }),
          ...(tz === undefined ? {} : { tz }),
        });
      },
    ),
    getJobSchedulers: vi.fn(async () => [...schedulers.values()]),
    removeJobScheduler: vi.fn(async (key: string) => schedulers.delete(key)),
    registeredNames: () => [...schedulers.values()].map((entry) => entry.name),
    registeredSchedules: () =>
      [...schedulers.values()].map((entry) => entry.pattern ?? entry.every).sort() as unknown[],
  };
  return queue;
}

type FakeQueue = ReturnType<typeof fakeQueue>;

async function register(queue: FakeQueue, jobId: string, entry: ConfiguredRepeatable): Promise<void> {
  await queue.add(entry.name, {}, { jobId, repeat: entry.repeat });
}

const DAILY: ConfiguredRepeatable = { name: 'backup-sweep', repeat: { pattern: '0 3 * * *', tz: 'UTC' } };
const EVERY_MINUTE: ConfiguredRepeatable = {
  name: 'backup-sweep',
  repeat: { pattern: '* * * * *', tz: 'UTC' },
};

describe('retireSupersededRepeatables', () => {
  it('leaves exactly the schedule the configuration names after its cron expression changed', async () => {
    const queue = fakeQueue();
    await register(queue, 'backup-sweep-singleton', EVERY_MINUTE);
    await register(queue, 'backup-sweep-singleton', DAILY);
    // Registering alone is what the bug looked like: BOTH definitions live in Redis, and the
    // per-minute one goes on firing.
    expect(queue.registeredSchedules()).toEqual(['* * * * *', '0 3 * * *']);

    const retired = await retireSupersededRepeatables(queue as unknown as Queue, [DAILY]);

    expect(retired).toEqual(['backup-sweep:UTC:* * * * *']);
    expect(queue.registeredSchedules()).toEqual(['0 3 * * *']);
  });

  it('retires a schedule the configuration dropped ENTIRELY, not only one whose expression changed', async () => {
    const queue = fakeQueue();
    const kept: ConfiguredRepeatable = { name: 'schedule-sweep', repeat: { every: 60_000 } };
    const dropped: ConfiguredRepeatable = { name: 'reception-sweep', repeat: { every: 60_000 } };
    await register(queue, 'schedule-sweep-singleton', kept);
    await register(queue, 'reception-sweep-singleton', dropped);

    const retired = await retireSupersededRepeatables(queue as unknown as Queue, [kept]);

    expect(retired).toEqual(['reception-sweep::60000']);
    expect(queue.registeredNames()).toEqual(['schedule-sweep']);
  });

  it('removes nothing when every registered definition is still named', async () => {
    const queue = fakeQueue();
    const sweeps: ConfiguredRepeatable[] = [
      { name: 'schedule-sweep', repeat: { every: 60_000 } },
      { name: 'conformity-sweep', repeat: { every: 300_000 } },
      DAILY,
    ];
    for (const sweep of sweeps) await register(queue, `${sweep.name}-singleton`, sweep);

    const retired = await retireSupersededRepeatables(queue as unknown as Queue, sweeps);

    expect(retired).toEqual([]);
    expect(queue.removeJobScheduler).not.toHaveBeenCalled();
    expect(queue.registeredNames()).toHaveLength(3);
  });

  it('tells two schedules apart by their timezone, not only their expression', async () => {
    const queue = fakeQueue();
    const paris: ConfiguredRepeatable = {
      name: 'backup-sweep',
      repeat: { pattern: '0 3 * * *', tz: 'Europe/Paris' },
    };
    await register(queue, 'backup-sweep-singleton', paris);
    await register(queue, 'backup-sweep-singleton', DAILY);

    await retireSupersededRepeatables(queue as unknown as Queue, [DAILY]);

    expect(queue.removeJobScheduler).toHaveBeenCalledTimes(1);
    expect(queue.registeredNames()).toEqual(['backup-sweep']);
  });

  it('never lets one replica delete what another just registered — the decision is the configuration', async () => {
    // Two replicas booting at once against the SAME Redis, both reading the same environment, with a
    // superseded per-minute definition already there. Interleaved worst-case: both register, then
    // both prune.
    const queue = fakeQueue();
    await register(queue, 'backup-sweep-singleton', EVERY_MINUTE);

    await register(queue, 'backup-sweep-singleton', DAILY);
    await register(queue, 'backup-sweep-singleton', DAILY);
    const firstReplica = await retireSupersededRepeatables(queue as unknown as Queue, [DAILY]);
    const secondReplica = await retireSupersededRepeatables(queue as unknown as Queue, [DAILY]);

    expect(firstReplica).toEqual(['backup-sweep:UTC:* * * * *']);
    // The second replica finds nothing left to retire — and above all has not removed the definition
    // the first one is relying on.
    expect(secondReplica).toEqual([]);
    expect(queue.registeredSchedules()).toEqual(['0 3 * * *']);
  });

  it('skips an orphan sorted-set entry BullMQ reports with no metadata of its own', async () => {
    const queue = fakeQueue();
    queue.getJobSchedulers.mockResolvedValue([undefined as never]);

    const retired = await retireSupersededRepeatables(queue as unknown as Queue, [DAILY]);

    expect(retired).toEqual([]);
    expect(queue.removeJobScheduler).not.toHaveBeenCalled();
  });
});
