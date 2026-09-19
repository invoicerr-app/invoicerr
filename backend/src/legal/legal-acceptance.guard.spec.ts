import { vi, type Mock } from 'vitest';

import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { LEGAL_ACCEPTANCE_REQUIRED_CODE, LegalAcceptanceGuard } from './legal-acceptance.guard';
import { getPendingAcceptanceSlugs } from './legal-acceptance';

vi.mock('./legal-acceptance');

const getPending = getPendingAcceptanceSlugs as Mock;

function buildContext(overrides: {
  method?: string;
  userId?: string;
  handlerMeta?: Record<string, unknown>;
}): ExecutionContext {
  const request = {
    method: overrides.method ?? 'POST',
    user: overrides.userId ? { id: overrides.userId } : undefined,
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
});
