/**
 * CompanyLookupService — one entry point for "fill this form from the official register".
 *
 * Given a country and an identifier, it walks that country's providers in order and
 * returns the first definitive answer. Results are memoised (registers are slow and
 * rate-limited, and the same number gets typed several times during onboarding);
 * transport failures are never cached so a temporary outage does not stick.
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
export const COMPANY_LOOKUP_TTL_MS = 'COMPANY_LOOKUP_TTL_MS';

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

  constructor(
    private readonly registry: CompanyLookupRegistry,
    // Optional + tokenised: Nest cannot resolve a bare `number` constructor parameter.
    @Optional() @Inject(COMPANY_LOOKUP_TTL_MS) ttlMs?: number,
  ) {
    this.ttlMs = ttlMs ?? DEFAULT_TTL_MS;
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
      return this.fail(
        'UNSUPPORTED_COUNTRY',
        this.registry.capability(countryCode).note ?? 'No registry API is available for this country',
      );
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

    for (const scheme of schemes) {
      const query: CompanyLookupQuery = { countryCode, scheme, value };
      for (const provider of providers) {
        if (!provider.schemes.includes(scheme)) continue;
        if (!provider.isConfigured()) continue;
        sawConfigured = true;
        if (!provider.supports(query)) continue;
        sawSupported = true;

        try {
          const company = await provider.lookup(query);
          if (company) {
            hits.push({ provider, company });
            // A source that only confirms the number (VIES where the member state hides
            // the name) is worth completing from the next one instead of returned as is.
            if (isComplete(company)) return this.merge(hits, countryCode);
          }
        } catch (err) {
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
   * Combines what several sources each knew about the same company, in the order they
   * were tried: the first non-empty value wins, so a national register is never
   * overwritten by a directory. Typical case: VIES proves the German VAT number is
   * live, GLEIF supplies the name and address it does not disclose.
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
