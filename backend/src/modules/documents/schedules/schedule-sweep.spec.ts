import { buildScheduleOccurrenceJobId, selectDueSchedules } from './schedule-sweep';

describe('selectDueSchedules', () => {
  const NOW = new Date('2026-08-31T12:00:00.000Z');

  it('picks a schedule whose nextRunAt is in the past', () => {
    const due = { id: 'a', enabled: true, nextRunAt: new Date('2026-08-01T00:00:00.000Z') };
    expect(selectDueSchedules([due], NOW)).toEqual([due]);
  });

  it('picks a schedule whose nextRunAt is EXACTLY now (inclusive boundary)', () => {
    const due = { id: 'a', enabled: true, nextRunAt: NOW };
    expect(selectDueSchedules([due], NOW)).toEqual([due]);
  });

  it('never picks a schedule whose nextRunAt is still in the future', () => {
    const notYet = { id: 'a', enabled: true, nextRunAt: new Date('2026-09-01T00:00:00.000Z') };
    expect(selectDueSchedules([notYet], NOW)).toEqual([]);
  });

  it('never picks a disabled schedule, however overdue', () => {
    const disabled = { id: 'a', enabled: false, nextRunAt: new Date('2020-01-01T00:00:00.000Z') };
    expect(selectDueSchedules([disabled], NOW)).toEqual([]);
  });

  it('a schedule three months overdue is still selected exactly ONCE, never expanded into several rows', () => {
    // This is the "catch-up" contract itself: selectDueSchedules never knows or cares HOW overdue a
    // schedule is — it is the caller (schedule-sweep-runner.ts) that enforces "one occurrence per
    // pass" by only ever asking computeNextOccurrence for a SINGLE next step, never looping here.
    const veryLate = { id: 'a', enabled: true, nextRunAt: new Date('2026-05-01T00:00:00.000Z') };
    const result = selectDueSchedules([veryLate, veryLate], NOW);
    expect(result).toHaveLength(2); // (two distinct array entries in, two out — this asserts no dedup surprise here)
    expect(selectDueSchedules([veryLate], NOW)).toEqual([veryLate]);
  });

  it('filters a mixed batch correctly, preserving order', () => {
    const due1 = { id: 'a', enabled: true, nextRunAt: new Date('2026-08-01T00:00:00.000Z') };
    const notYet = { id: 'b', enabled: true, nextRunAt: new Date('2026-09-01T00:00:00.000Z') };
    const due2 = { id: 'c', enabled: true, nextRunAt: new Date('2026-08-30T00:00:00.000Z') };
    const disabled = { id: 'd', enabled: false, nextRunAt: new Date('2020-01-01T00:00:00.000Z') };
    expect(selectDueSchedules([due1, notYet, due2, disabled], NOW)).toEqual([due1, due2]);
  });
});

describe('buildScheduleOccurrenceJobId', () => {
  it('is deterministic: the same (scheduleId, occurrenceAt) always produces the same id', () => {
    const occurrenceAt = new Date('2026-09-30T00:00:00.000Z');
    expect(buildScheduleOccurrenceJobId('sched-1', occurrenceAt)).toBe(
      buildScheduleOccurrenceJobId('sched-1', occurrenceAt),
    );
  });

  // THE MUTATION TARGET: dropping the occurrence timestamp from this id (e.g. returning just
  // `schedule-${scheduleId}`) is exactly what would make two DIFFERENT occurrences of the same
  // schedule collide on the same jobId — the dedup guarantee this file's own header describes would
  // then also (wrongly) swallow a SECOND, genuinely distinct month's occurrence. This test fails the
  // moment that happens.
  it('is DISTINCT for two different occurrences of the SAME schedule', () => {
    const september = buildScheduleOccurrenceJobId('sched-1', new Date('2026-09-30T00:00:00.000Z'));
    const october = buildScheduleOccurrenceJobId('sched-1', new Date('2026-10-31T00:00:00.000Z'));
    expect(september).not.toBe(october);
  });

  it('is DISTINCT for the same occurrence date across two different schedules', () => {
    const occurrenceAt = new Date('2026-09-30T00:00:00.000Z');
    expect(buildScheduleOccurrenceJobId('sched-1', occurrenceAt)).not.toBe(
      buildScheduleOccurrenceJobId('sched-2', occurrenceAt),
    );
  });

  it('never contains a ":" — reserved by BullMQ for its own repeatable job id format', () => {
    const id = buildScheduleOccurrenceJobId('sched-1', new Date('2026-09-30T00:00:00.000Z'));
    expect(id).not.toContain(':');
  });
});
