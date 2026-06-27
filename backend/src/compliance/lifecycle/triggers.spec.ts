import { triggerForFeedback } from './triggers';

describe('triggerForFeedback', () => {
  it('ASYNC_POLL → POLL carrying the given policy + providerId', () => {
    const t = triggerForFeedback('ASYNC_POLL', { poll: { everySeconds: 30, timeoutHours: 24 }, providerId: 'pac' });
    expect(t.kind).toBe('POLL');
    if (t.kind === 'POLL') {
      expect(t.poll.everySeconds).toBe(30);
      expect(t.channelProviderId).toBe('pac');
    }
  });

  it('ASYNC_POLL with no policy falls back to a sane default', () => {
    const t = triggerForFeedback('ASYNC_POLL');
    expect(t.kind).toBe('POLL');
    if (t.kind === 'POLL') expect(t.poll.everySeconds).toBeGreaterThan(0);
  });

  it('ASYNC_CALLBACK → CALLBACK', () => {
    expect(triggerForFeedback('ASYNC_CALLBACK').kind).toBe('CALLBACK');
  });

  it('SYNC / NONE / undefined → IMMEDIATE', () => {
    expect(triggerForFeedback('SYNC').kind).toBe('IMMEDIATE');
    expect(triggerForFeedback('NONE').kind).toBe('IMMEDIATE');
    expect(triggerForFeedback(undefined).kind).toBe('IMMEDIATE');
  });
});
