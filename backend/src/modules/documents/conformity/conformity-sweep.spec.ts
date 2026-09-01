import { buildConformityPollJobId, decideConformityAction, GAVE_UP_STATUS_CODE } from './conformity-sweep';

const PDP_IS_TERMINAL = (code: string) => code === 'fr:202' || code === 'fr:213';

function candidate(overrides: Partial<Parameters<typeof decideConformityAction>[0]> = {}) {
  return {
    id: 'doc-1',
    companyId: 'company-1',
    transportRef: '123456',
    channelProviderId: 'pdp',
    sentAt: new Date('2026-08-01T00:00:00.000Z'),
    existingStatusCodes: [] as string[],
    ...overrides,
  };
}

describe('decideConformityAction — eligibility', () => {
  const NOW = new Date('2026-08-02T00:00:00.000Z'); // one day after sentAt — well within the budget
  const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

  it('polls a sent document with a transportRef and no verdict yet', () => {
    expect(decideConformityAction(candidate(), PDP_IS_TERMINAL, NOW, MAX_AGE_MS)).toEqual({
      action: 'poll',
    });
  });

  it("skips a document that already carries the provider's own terminal ACCEPT code (fr:202)", () => {
    const c = candidate({ existingStatusCodes: ['fr:200', 'fr:201', 'fr:202'] });
    expect(decideConformityAction(c, PDP_IS_TERMINAL, NOW, MAX_AGE_MS)).toEqual({ action: 'skip' });
  });

  it("skips a document that already carries the provider's own terminal REJECT code (fr:213)", () => {
    const c = candidate({ existingStatusCodes: ['fr:200', 'fr:213'] });
    expect(decideConformityAction(c, PDP_IS_TERMINAL, NOW, MAX_AGE_MS)).toEqual({ action: 'skip' });
  });

  it('does NOT skip on a merely intermediate code (fr:200/fr:201 alone) — still polls', () => {
    const c = candidate({ existingStatusCodes: ['fr:200', 'fr:201'] });
    expect(decideConformityAction(c, PDP_IS_TERMINAL, NOW, MAX_AGE_MS)).toEqual({ action: 'poll' });
  });

  it('skips a document already marked poll:gave-up — never re-computed as "gave-up" again', () => {
    const c = candidate({ existingStatusCodes: [GAVE_UP_STATUS_CODE] });
    // Even though this candidate is ALSO past the max age, the already-terminal check wins first —
    // never a second 'gave-up' write attempt for the same document.
    const farFuture = new Date('2027-01-01T00:00:00.000Z');
    expect(decideConformityAction(c, PDP_IS_TERMINAL, farFuture, MAX_AGE_MS)).toEqual({ action: 'skip' });
  });

  it('gives up once the max poll age is exceeded with no terminal verdict ever seen', () => {
    const pastDeadline = new Date(candidate().sentAt.getTime() + MAX_AGE_MS + 1);
    expect(decideConformityAction(candidate(), PDP_IS_TERMINAL, pastDeadline, MAX_AGE_MS)).toEqual({
      action: 'gave-up',
    });
  });

  it('does not give up exactly AT the boundary — only once strictly exceeded', () => {
    const atDeadline = new Date(candidate().sentAt.getTime() + MAX_AGE_MS);
    expect(decideConformityAction(candidate(), PDP_IS_TERMINAL, atDeadline, MAX_AGE_MS)).toEqual({
      action: 'poll',
    });
  });

  it('a poll:blocked event does NOT count as terminal — still polled again next pass', () => {
    const c = candidate({ existingStatusCodes: ['poll:blocked'] });
    expect(decideConformityAction(c, PDP_IS_TERMINAL, NOW, MAX_AGE_MS)).toEqual({ action: 'poll' });
  });
});

describe('buildConformityPollJobId — the wall-clock-window dedup key', () => {
  const intervalMs = 60_000;

  it('produces the SAME id for two calls in the same window (the race two overlapping sweeps hit)', () => {
    const now = new Date('2026-08-01T10:00:00.000Z');
    const a = buildConformityPollJobId('doc-1', now, intervalMs);
    const b = buildConformityPollJobId('doc-1', new Date(now.getTime() + 5), intervalMs);
    expect(a).toBe(b);
  });

  it('produces a DIFFERENT id for the next window — a still-non-terminal document is pollable again', () => {
    const now = new Date('2026-08-01T10:00:00.000Z');
    const a = buildConformityPollJobId('doc-1', now, intervalMs);
    const b = buildConformityPollJobId('doc-1', new Date(now.getTime() + intervalMs), intervalMs);
    expect(a).not.toBe(b);
  });

  it('is scoped per document — two different documents in the same window never collide', () => {
    const now = new Date('2026-08-01T10:00:00.000Z');
    const a = buildConformityPollJobId('doc-1', now, intervalMs);
    const b = buildConformityPollJobId('doc-2', now, intervalMs);
    expect(a).not.toBe(b);
  });
});
