/**
 * Walks a country's providers in order and returns the first definitive answer. Results are
 * memoised because registers are slow and rate-limited; transport failures are never cached, so a
 * temporary outage does not stick.
 */
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { CompanyLookupRegistry } from './registry';
import {
  CompanyLookupCompany,
  CompanyLookupQuery,
  CompanyLookupResult,
  CompanyRegistryProvider,
  CountryLookupCapability,
  LookupScheme,
  ProviderLookupError,
} from './types';

/** Registers update daily at best; six hours keeps a form session cheap without going stale. */
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;

/** Optional DI token so a deployment (or a test) can shorten the cache. */
const COMPANY_LOOKUP_TTL_MS = 'COMPANY_LOOKUP_TTL_MS';

/**
 * Total time one lookup may spend across its whole provider chain (issue #786). Each provider keeps
 * its own per-call timeout (`http.ts#DEFAULT_TIMEOUT_MS`, 8 s), but a country walks up to three of them
 * in turn, so a register outage used to hold the onboarding "Next" button for 24 s. Past this budget
 * the service stops asking and answers PROVIDER_ERROR (or what it already found), and the form lets
 * the user type the details themselves.
 */
export const DEFAULT_LOOKUP_BUDGET_MS = 5000;

/** Optional DI token for the budget (tests); otherwise the env var `COMPANY_LOOKUP_BUDGET_MS`, then the default. */
export const COMPANY_LOOKUP_BUDGET_MS = 'COMPANY_LOOKUP_BUDGET_MS';

/** A positive integer from the env, or `undefined` (logged) so the default applies. */
export function budgetFromEnv(raw: string | undefined, logger?: Pick<Logger, 'warn'>): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const value = Number(raw);
  if (Number.isInteger(value) && value > 0) return value;
  logger?.warn(
    `COMPANY_LOOKUP_BUDGET_MS="${raw}" is not a positive integer; using ${DEFAULT_LOOKUP_BUDGET_MS}ms.`,
  );
  return undefined;
}

/** Thrown internally when the chain's budget runs out before a provider answers. */
class LookupBudgetExhausted extends Error {}

/**
 * "Complete enough to stop asking": the source gave a real registered name or an
 * address. A bare VAT confirmation is not — the next source may still fill it in.
 */
function isComplete(company: CompanyLookupCompany): boolean {
  return Boolean(company.legalName || company.address || company.city);
}

interface CacheEntry {
  result: CompanyLookupResult;
  expiresAt: number;
}

@Injectable()
export class CompanyLookupService {
  private readonly logger = new Logger(CompanyLookupService.name);
  private readonly cache = new Map<string, CacheEntry>();

  private readonly ttlMs: number;
  private readonly budgetMs: number;

  constructor(
    private readonly registry: CompanyLookupRegistry,
    // Optional + tokenised: Nest cannot resolve a bare `number` constructor parameter.
    @Optional() @Inject(COMPANY_LOOKUP_TTL_MS) ttlMs?: number,
    @Optional() @Inject(COMPANY_LOOKUP_BUDGET_MS) budgetMs?: number,
  ) {
    this.ttlMs = ttlMs ?? DEFAULT_TTL_MS;
    this.budgetMs =
      budgetMs ??
      budgetFromEnv(process.env.COMPANY_LOOKUP_BUDGET_MS, this.logger) ??
      DEFAULT_LOOKUP_BUDGET_MS;
  }

  capabilities(): CountryLookupCapability[] {
    return this.registry.capabilities();
  }

  capability(countryCode: string): CountryLookupCapability {
    return this.registry.capability(countryCode);
  }

  /**
   * @param scheme  Omit to try the national registration number first, then the VAT number.
   */
  async lookup(input: {
    countryCode: string;
    value: string;
    scheme?: LookupScheme;
  }): Promise<CompanyLookupResult> {
    const countryCode = (input.countryCode ?? '').trim().toUpperCase();
    const value = (input.value ?? '').trim();

    if (!/^[A-Z]{2}$/.test(countryCode)) {
      return this.fail('INVALID_IDENTIFIER', 'A 2-letter ISO country code is required');
    }
    if (!value) {
      return this.fail('INVALID_IDENTIFIER', 'An identifier is required');
    }

    const providers = this.registry.forCountry(countryCode);
    if (providers.length === 0) {
      return this.fail('UNSUPPORTED_COUNTRY', 'No registry API is available for this country');
    }

    const cacheKey = `${countryCode}:${input.scheme ?? 'AUTO'}:${value.toUpperCase()}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.result;

    const schemes: LookupScheme[] = input.scheme ? [input.scheme] : ['LEGAL_ID', 'VAT'];
    const result = await this.run(providers, countryCode, value, schemes);

    // Only definitive answers are worth remembering.
    if (!result.error) this.cache.set(cacheKey, { result, expiresAt: Date.now() + this.ttlMs });
    return result;
  }

  private async run(
    providers: CompanyRegistryProvider[],
    countryCode: string,
    value: string,
    schemes: LookupScheme[],
  ): Promise<CompanyLookupResult> {
    let lastError: CompanyLookupResult | null = null;
    let sawConfigured = false;
    let sawSupported = false;
    const hits: { provider: CompanyRegistryProvider; company: CompanyLookupCompany }[] = [];
    const deadline = Date.now() + this.budgetMs;

    for (const scheme of schemes) {
      const query: CompanyLookupQuery = { countryCode, scheme, value };
      for (const provider of providers) {
        if (!provider.schemes.includes(scheme)) continue;
        if (!provider.isConfigured()) continue;
        sawConfigured = true;
        if (!provider.supports(query)) continue;
        sawSupported = true;

        try {
          const company = await this.withinBudget(provider.lookup(query), deadline);
          if (company) {
            hits.push({ provider, company });
            // A source that only confirms the number is worth completing from the next one.
            if (isComplete(company)) return this.merge(hits, countryCode);
          }
        } catch (err) {
          if (err instanceof LookupBudgetExhausted) {
            this.logger.warn(
              `${provider.id} lookup for ${countryCode}/${value} cut at the ${this.budgetMs}ms total budget`,
            );
            // What an earlier source already found is still worth returning.
            if (hits.length > 0) return this.merge(hits, countryCode);
            return {
              found: false,
              company: null,
              source: provider.id,
              sourceLabel: provider.label,
              error: 'PROVIDER_ERROR',
              message: `Company registers did not answer within ${this.budgetMs}ms`,
            };
          }
          const code = err instanceof ProviderLookupError ? err.code : 'PROVIDER_ERROR';
          const message = err instanceof Error ? err.message : String(err);
          this.logger.warn(`${provider.id} lookup failed for ${countryCode}/${value}: ${message}`);
          lastError = {
            found: false,
            company: null,
            source: provider.id,
            sourceLabel: provider.label,
            error: code,
            message,
          };
        }
      }
    }

    if (hits.length > 0) return this.merge(hits, countryCode);

    if (!sawConfigured) {
      const capability = this.registry.capability(countryCode);
      const missing = capability.providers.flatMap((p) => p.credentialEnvVars ?? []);
      return this.fail(
        'NOT_CONFIGURED',
        missing.length > 0
          ? `This lookup needs ${missing.join(' / ')} to be configured on the server`
          : 'No configured registry provider for this country',
      );
    }
    if (!sawSupported) {
      const capability = this.registry.capability(countryCode);
      return this.fail(
        'INVALID_IDENTIFIER',
        capability.identifierLabel
          ? `Expected ${capability.identifierLabel}`
          : "The identifier does not match this country's format",
      );
    }
    // A registry that answered "no such entity" is a real result, not a failure.
    return lastError ?? { found: false, company: null };
  }

  /**
   * Races one provider call against what is left of the chain's budget. The losing call is left to
   * settle on its own per-call timeout; its result is ignored and its rejection swallowed, so it
   * never surfaces as an unhandled rejection.
   */
  private async withinBudget<T>(call: Promise<T>, deadline: number): Promise<T> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      call.catch(() => undefined);
      throw new LookupBudgetExhausted();
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expiry = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new LookupBudgetExhausted()), remaining);
    });
    try {
      return await Promise.race([call, expiry]);
    } finally {
      clearTimeout(timer);
      call.catch(() => undefined);
    }
  }

  /**
   * First non-empty value wins, in the order the sources were tried, so a national register is
   * never overwritten by a directory.
   */
  private merge(
    hits: { provider: CompanyRegistryProvider; company: CompanyLookupCompany }[],
    countryCode: string,
  ): CompanyLookupResult {
    const [first, ...rest] = hits;
    const merged: CompanyLookupCompany = { ...first.company };
    const contributors = [first.provider];

    for (const { provider, company } of rest) {
      let contributed = false;
      for (const [key, value] of Object.entries(company) as [keyof CompanyLookupCompany, unknown][]) {
        if (value === undefined || value === null || value === '') continue;
        if (merged[key] === undefined || merged[key] === null || merged[key] === '') {
          (merged as unknown as Record<string, unknown>)[key] = value;
          contributed = true;
        }
      }
      // The placeholder name a non-disclosing source produced must not outrank a real one.
      if (!first.company.legalName && company.legalName) {
        merged.name = company.legalName;
        merged.legalName = company.legalName;
        contributed = true;
      }
      if (contributed) contributors.push(provider);
    }

    return {
      found: true,
      company: this.decorate(merged, countryCode),
      source: first.provider.id,
      sources: contributors.map((p) => p.id),
      sourceLabel: contributors.map((p) => p.label).join(' + '),
    };
  }

  /** Fills in what every provider would otherwise repeat. */
  private decorate(company: CompanyLookupCompany, countryCode: string): CompanyLookupCompany {
    return {
      ...company,
      countryCode: company.countryCode ?? countryCode,
      status: company.status ?? 'UNKNOWN',
    };
  }

  private fail(error: CompanyLookupResult['error'], message: string): CompanyLookupResult {
    return { found: false, company: null, error, message };
  }
}
