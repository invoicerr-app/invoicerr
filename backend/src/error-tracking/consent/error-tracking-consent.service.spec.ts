import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import prisma from '@/prisma/prisma.service';

vi.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    errorTrackingConsent: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  },
}));

import { ERROR_TRACKING_CONSENT_TEXT_VERSION } from './consent-policy';
import { ErrorTrackingConsentService } from './error-tracking-consent.service';

const create = prisma.errorTrackingConsent.create as Mock;
const findFirst = prisma.errorTrackingConsent.findFirst as Mock;
const NOW = new Date('2026-11-21T12:00:00Z');

describe('ErrorTrackingConsentService', () => {
  const service = new ErrorTrackingConsentService();

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SENTRY_FRONTEND_DSN = 'https://public@glitchtip.example.test/2';
    create.mockImplementation(({ data }) =>
      Promise.resolve({ decision: data.decision, textVersion: data.textVersion, decidedAt: data.decidedAt }),
    );
  });

  it('is off for a user who never decided', async () => {
    findFirst.mockResolvedValue(null);
    const view = await service.getView('u1', NOW);
    expect(view.granted).toBe(false);
    expect(view.browser).toBeNull();
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'u1' } }));
  });

  it('stores a grant as a new row with the text version and channel', async () => {
    findFirst.mockResolvedValue(null);
    const view = await service.decide('u1', true, 'banner', NOW);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          userId: 'u1',
          decision: 'granted',
          channel: 'banner',
          textVersion: ERROR_TRACKING_CONSENT_TEXT_VERSION,
          decidedAt: NOW,
        },
      }),
    );
    expect(view.granted).toBe(true);
    expect(view.browser?.dsn).toBe('https://public@glitchtip.example.test/2');
  });

  it('appends a withdrawal after a grant and never updates the earlier row', async () => {
    findFirst.mockResolvedValue({
      decision: 'granted',
      textVersion: ERROR_TRACKING_CONSENT_TEXT_VERSION,
      decidedAt: NOW,
    });
    const view = await service.decide('u1', false, 'settings', NOW);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ decision: 'withdrawn', channel: 'settings' }),
      }),
    );
    expect(prisma.errorTrackingConsent.update).not.toHaveBeenCalled();
    expect(prisma.errorTrackingConsent.updateMany).not.toHaveBeenCalled();
    expect(view).toMatchObject({ granted: false, decision: 'withdrawn', browser: null });
  });

  it('stores a first "no" as a refusal', async () => {
    findFirst.mockResolvedValue(null);
    const view = await service.decide('u1', false, 'banner', NOW);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ decision: 'refused' }) }),
    );
    expect(view).toMatchObject({ granted: false, decisionRequired: false, decision: 'refused' });
  });
});
