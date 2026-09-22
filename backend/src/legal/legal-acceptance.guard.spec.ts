import { vi, type Mock } from 'vitest';

import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { LEGAL_ACCEPTANCE_REQUIRED_CODE, LegalAcceptanceGuard } from './legal-acceptance.guard';
import { getPendingAcceptanceSlugs } from './legal-acceptance';
import { filterPendingSlugsAfterPaidPeriodGrace } from './terms-paid-period-exemption';

vi.mock('./legal-acceptance');
vi.mock('./terms-paid-period-exemption');

const getPending = getPendingAcceptanceSlugs as Mock;
const filterAfterGrace = filterPendingSlugsAfterPaidPeriodGrace as Mock;

function buildContext(overrides: {
  method?: string;
  userId?: string;
  companyId?: string | null;
  handlerMeta?: Record<string, unknown>;
}): ExecutionContext {
  const request = {
    method: overrides.method ?? 'POST',
    user: overrides.userId ? { id: overrides.userId } : undefined,
    companyId: overrides.companyId ?? null,
  };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({ __meta: overrides.handlerMeta ?? {} }),
    getClass: () => ({ __meta: {} }),
  } as unknown as ExecutionContext;
}

/** A `Reflector` whose `getAllAndOverride` reads straight off the fake handler's own `__meta` bag —
 *  simpler than driving real `SetMetadata`/`Reflect` plumbing for a unit spec, and behaviorally
 *  identical for this guard's one call site (a single boolean key, handler-then-class precedence never
 *  exercised here since the class never carries the key in these specs). */
function fakeReflector(): Reflector {
  return {
    getAllAndOverride: (key: string, targets: unknown[]) => {
      for (const target of targets as { __meta?: Record<string, unknown> }[]) {
        if (target?.__meta && key in target.__meta) return target.__meta[key];
      }
      return undefined;
    },
  } as unknown as Reflector;
}

describe('LegalAcceptanceGuard', () => {
  beforeEach(() => {
    // Default: no paid-period exception applies — the guard sees exactly what was pending, the same
    // behavior every test in this file predates this exception with. Overridden per-case below for the
    // tests that specifically exercise the exception's wiring.
    filterAfterGrace.mockImplementation((pending: readonly string[]) => Promise.resolve([...pending]));
  });
  afterEach(() => vi.clearAllMocks());

  it('never checks the DB for a read-only request (GET/HEAD/OPTIONS) — looking is always allowed', async () => {
    const guard = new LegalAcceptanceGuard(fakeReflector());

    await expect(guard.canActivate(buildContext({ method: 'GET', userId: 'user-1' }))).resolves.toBe(true);
    expect(getPending).not.toHaveBeenCalled();
  });

  it('lets an unauthenticated request through untouched — /api/auth/* and the public client portal', async () => {
    const guard = new LegalAcceptanceGuard(fakeReflector());

    await expect(guard.canActivate(buildContext({ method: 'POST' }))).resolves.toBe(true);
    expect(getPending).not.toHaveBeenCalled();
  });

  it('lets the exempt route through (POST /legal/accept) without ever reading pending state', async () => {
    const guard = new LegalAcceptanceGuard(fakeReflector());

    await expect(
      guard.canActivate(
        buildContext({ method: 'POST', userId: 'user-1', handlerMeta: { legalGateExempt: true } }),
      ),
    ).resolves.toBe(true);
    expect(getPending).not.toHaveBeenCalled();
  });

  it('allows a business write when nothing is pending', async () => {
    getPending.mockResolvedValue([]);
    const guard = new LegalAcceptanceGuard(fakeReflector());

    await expect(guard.canActivate(buildContext({ method: 'POST', userId: 'user-1' }))).resolves.toBe(true);
  });

  it(
    'refuses a business write with a 403 named LEGAL_ACCEPTANCE_REQUIRED — the actual defect this ' +
      'closes: the frontend interstitial used to be the ONLY thing standing in the way',
    async () => {
      getPending.mockResolvedValue(['terms-of-service']);
      const guard = new LegalAcceptanceGuard(fakeReflector());

      const action = guard.canActivate(buildContext({ method: 'POST', userId: 'user-1' }));

      await expect(action).rejects.toBeInstanceOf(ForbiddenException);
      const error = await action.catch((e) => e);
      expect(error.getResponse()).toMatchObject({ code: LEGAL_ACCEPTANCE_REQUIRED_CODE });
    },
  );

  it('refuses an API-key-authenticated write identically — closes the "quiconque... clé d\'API" gap', async () => {
    // AuthGuard sets `request.user` for BOTH session and API-key auth (its own header) — this guard
    // makes no distinction between the two, deliberately.
    getPending.mockResolvedValue(['privacy-policy']);
    const guard = new LegalAcceptanceGuard(fakeReflector());

    await expect(
      guard.canActivate(buildContext({ method: 'DELETE', userId: 'api-key-user' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it(
    'the refusal names the actual document title (never the raw slug), and states that reading, ' +
      'exporting and leaving/closing the account all remain available — this is a write gate, not a ' +
      'lockout, and the response has to say so for itself',
    async () => {
      getPending.mockResolvedValue(['terms-of-service']);
      const guard = new LegalAcceptanceGuard(fakeReflector());

      const action = guard.canActivate(buildContext({ method: 'POST', userId: 'user-1' }));
      const error = await action.catch((e) => e);
      const body = error.getResponse();

      expect(body).toMatchObject({
        code: LEGAL_ACCEPTANCE_REQUIRED_CODE,
        pending: ['terms-of-service'],
        readOnly: true,
      });
      expect(body.message).toContain('Terms of Service');
      expect(body.message).not.toContain('terms-of-service');
      expect(body.message.toLowerCase()).toContain('export');
      expect(body.message.toLowerCase()).toContain('close your account');
    },
  );

  describe('Terms of Service Section 20.2 — a subscription period already in progress', () => {
    it(
      'passes request.companyId through and allows the write once the exception clears ' +
        'terms-of-service down to an empty blocking list',
      async () => {
        getPending.mockResolvedValue(['terms-of-service']);
        filterAfterGrace.mockResolvedValue([]);
        const guard = new LegalAcceptanceGuard(fakeReflector());

        await expect(
          guard.canActivate(buildContext({ method: 'POST', userId: 'user-1', companyId: 'company-1' })),
        ).resolves.toBe(true);
        expect(filterAfterGrace).toHaveBeenCalledWith(['terms-of-service'], 'company-1');
      },
    );

    it(
      'still refuses the write, naming only the still-blocking document, when a co-pending ' +
        'privacy-policy is not excused by the exception',
      async () => {
        getPending.mockResolvedValue(['terms-of-service', 'privacy-policy']);
        filterAfterGrace.mockResolvedValue(['privacy-policy']);
        const guard = new LegalAcceptanceGuard(fakeReflector());

        const action = guard.canActivate(
          buildContext({ method: 'POST', userId: 'user-1', companyId: 'company-1' }),
        );
        const error = await action.catch((e) => e);

        expect(error).toBeInstanceOf(ForbiddenException);
        const body = error.getResponse();
        expect(body).toMatchObject({ pending: ['privacy-policy'] });
        expect(body.message).toContain('Privacy Policy');
        expect(body.message).not.toContain('Terms of Service');
      },
    );

    it('refuses the write, naming terms-of-service, once the exception no longer excuses it (period ended)', async () => {
      getPending.mockResolvedValue(['terms-of-service']);
      filterAfterGrace.mockResolvedValue(['terms-of-service']);
      const guard = new LegalAcceptanceGuard(fakeReflector());

      await expect(
        guard.canActivate(buildContext({ method: 'POST', userId: 'user-1', companyId: 'company-1' })),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('passes null through for a request with no active company — nothing for the exception to protect', async () => {
      getPending.mockResolvedValue(['terms-of-service']);
      filterAfterGrace.mockResolvedValue(['terms-of-service']);
      const guard = new LegalAcceptanceGuard(fakeReflector());

      await guard.canActivate(buildContext({ method: 'POST', userId: 'user-1' })).catch(() => undefined);

      expect(filterAfterGrace).toHaveBeenCalledWith(['terms-of-service'], null);
    });
  });
});
