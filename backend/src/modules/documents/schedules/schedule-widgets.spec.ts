import { buildUpcomingSchedulesWidget } from './schedule-widgets';
import { DocumentScheduleRecord } from './schedule.persistence';

function schedule(overrides: Partial<DocumentScheduleRecord>): DocumentScheduleRecord {
  return {
    id: 'sched-1',
    companyId: 'company-1',
    typeId: 'invoice',
    sourceDocumentId: 'doc-1',
    actionId: 'duplicate',
    cadence: 'monthly',
    anchorDay: 31,
    nextRunAt: new Date('2026-09-30T00:00:00.000Z'),
    lastRunAt: null,
    lastError: null,
    enabled: true,
    params: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('buildUpcomingSchedulesWidget', () => {
  it('always returns a shortList widget, even with zero schedules', () => {
    expect(buildUpcomingSchedulesWidget([], {})).toEqual({
      id: 'document-schedule:upcoming',
      kind: 'shortList',
      label: 'Upcoming recurrences',
      items: [],
    });
  });

  it('sorts by nextRunAt ascending, resolves the type label, and formats the date as YYYY-MM-DD', () => {
    const soon = schedule({ id: 'a', nextRunAt: new Date('2026-09-10T00:00:00.000Z') });
    const later = schedule({ id: 'b', nextRunAt: new Date('2026-10-31T00:00:00.000Z') });

    const widget = buildUpcomingSchedulesWidget([later, soon], { invoice: 'Invoice' });

    expect(widget.items).toEqual([
      { id: 'a', primary: 'Invoice — duplicate', secondary: '2026-09-10' },
      { id: 'b', primary: 'Invoice — duplicate', secondary: '2026-10-31' },
    ]);
  });

  it('never includes a disabled schedule', () => {
    const disabled = schedule({ enabled: false });
    expect(buildUpcomingSchedulesWidget([disabled], { invoice: 'Invoice' }).items).toEqual([]);
  });

  it('falls back to the bare typeId when the type is no longer registered', () => {
    const widget = buildUpcomingSchedulesWidget([schedule({ typeId: 'gone' })], {});
    expect(widget.items[0].primary).toBe('gone — duplicate');
  });

  it('caps at the 5 soonest', () => {
    const many = Array.from({ length: 7 }, (_, i) =>
      schedule({ id: `s${i}`, nextRunAt: new Date(Date.UTC(2026, 0, i + 1)) }),
    );
    const widget = buildUpcomingSchedulesWidget(many, {});
    expect(widget.items).toHaveLength(5);
    expect(widget.items[0].id).toBe('s0');
    expect(widget.items[4].id).toBe('s4');
  });
});
