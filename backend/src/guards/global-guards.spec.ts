import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Provider, Type } from '@nestjs/common';

import { AuthGuard } from '@/guards/auth.guard';
import { CompanyWriteGuard } from '@/modules/billing/company-write.guard';
import { LegalAcceptanceGuard } from '@/legal/legal-acceptance.guard';
import { RolesGuard } from '@/guards/roles.guard';
import { globalGuardProviders } from '@/guards/global-guards';

/**
 * The order of the global guard chain, asserted directly.
 *
 * Nest runs `APP_GUARD` providers in the order they appear here and stops at the first refusal, so
 * this array IS the order every request meets. The assertion that matters is the first one below:
 * with the rate limiter behind the authenticator, a request refused by `AuthGuard` is never counted,
 * and an anonymous caller presenting invented API keys spends a `prisma.apiKey.findUnique` per
 * request against no budget at all.
 */
function guardClasses(providers: Provider[]): string[] {
  return providers.map((provider) => {
    const entry = provider as { provide?: unknown; useClass?: Type<unknown> };
    expect(entry.provide).toBe(APP_GUARD);
    expect(entry.useClass).toBeDefined();
    return (entry.useClass as Type<unknown>).name;
  });
}

describe('globalGuardProviders — the order every request meets', () => {
  it('runs the rate limiter BEFORE authentication, so a refused request is still counted', () => {
    const order = guardClasses(globalGuardProviders({ billingEnabled: false }));
    expect(order.indexOf(ThrottlerGuard.name)).toBeLessThan(order.indexOf(AuthGuard.name));
  });

  it('puts the rate limiter first outright — nothing runs in front of the budget', () => {
    expect(guardClasses(globalGuardProviders({ billingEnabled: false }))[0]).toBe(ThrottlerGuard.name);
    expect(guardClasses(globalGuardProviders({ billingEnabled: true }))[0]).toBe(ThrottlerGuard.name);
  });

  it('still authenticates before it authorises', () => {
    const order = guardClasses(globalGuardProviders({ billingEnabled: false }));
    expect(order.indexOf(AuthGuard.name)).toBeLessThan(order.indexOf(RolesGuard.name));
  });

  it('keeps the self-hosted chain to the three unconditional guards', () => {
    expect(guardClasses(globalGuardProviders({ billingEnabled: false }))).toEqual([
      ThrottlerGuard.name,
      AuthGuard.name,
      RolesGuard.name,
    ]);
  });

  it('adds the two billing gates only under the flag, and only after authorisation', () => {
    // Both read `request.role`/`request.companyId`, which `AuthGuard` populates — so unlike the rate
    // limiter, these two genuinely have to stay behind it.
    expect(guardClasses(globalGuardProviders({ billingEnabled: true }))).toEqual([
      ThrottlerGuard.name,
      AuthGuard.name,
      RolesGuard.name,
      CompanyWriteGuard.name,
      LegalAcceptanceGuard.name,
    ]);
  });

  it('registers every entry as an APP_GUARD — a mistyped token is a guard that silently never runs', () => {
    expect(() => guardClasses(globalGuardProviders({ billingEnabled: true }))).not.toThrow();
  });
});
