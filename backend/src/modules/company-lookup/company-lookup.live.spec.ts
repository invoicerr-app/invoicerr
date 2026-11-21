/**
 * Live registry lookups: opt-in, real HTTP, keyless registers only.
 *
 *   COMPANY_LOOKUP_LIVE=1 npx vitest run src/modules/company-lookup/company-lookup.live.spec.ts
 *
 * Each case queries a well-known public entity, so a failure means the registry changed its
 * contract rather than the data moving.
 */

import { vi } from 'vitest';

import { CompanyLookupService } from './company-lookup.service';
import { USER_AGENT } from './http';
import { PeppolDirectoryProvider } from './providers/peppol-directory.provider';
import { CompanyLookupRegistry } from './registry';
import { ProviderLookupError } from './types';

const live = process.env.COMPANY_LOOKUP_LIVE === '1';
const describeLive = live ? describe : describe.skip;

describeLive('company lookup — live registries', () => {
  const service = new CompanyLookupService(new CompanyLookupRegistry());

  vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

  // The service swallows a provider failure and falls back to the next source (often GLEIF), so the
  // result alone cannot tell an outage from a contract change. Its per-provider warning can.
  const failures = new Map<string, string>();
  beforeEach(() => {
    failures.clear();
    const logger = (service as unknown as { logger: { warn: (message: string) => void } }).logger;
    const warn = logger.warn.bind(logger);
    vi.spyOn(logger, 'warn').mockImplementation((message: string) => {
      const match = /^(\S+) lookup failed for \S+: (.*)$/.exec(message);
      if (match) failures.set(match[1], match[2]);
      warn(message);
    });
  });
  afterEach(() => vi.restoreAllMocks());

  const cases: { country: string; value: string; expect: RegExp; source: string }[] = [
    // EDF's head-office SIRET — a branch SIRET is deliberately rejected (see fr.provider.ts).
    {
      country: 'FR',
      value: '55208131766522',
      expect: /ELECTRICITE DE FRANCE/i,
      source: 'fr-recherche-entreprises',
    },
    { country: 'CZ', value: '45274649', expect: /ČEZ/i, source: 'cz-ares' },
    { country: 'SK', value: '35697270', expect: /Orange/i, source: 'sk-rpo' },
    { country: 'PL', value: '5260250274', expect: /FINANSÓW/i, source: 'pl-wykaz-vat' },
    { country: 'RO', value: '14399840', expect: /DANTE/i, source: 'ro-anaf' },
    { country: 'NO', value: '923609016', expect: /EQUINOR/i, source: 'no-brreg' },
    { country: 'DK', value: '25313763', expect: /ARLA/i, source: 'dk-cvr' },
    { country: 'FI', value: '0112038-9', expect: /Nokia/i, source: 'fi-prh' },
    { country: 'BR', value: '19131243000197', expect: /KNOWLEDGE|CONHECIMENTO/i, source: 'br-cnpj' },
    { country: 'PE', value: '20131312955', expect: /SUNAT|ADUANAS/i, source: 'pe-sunat' },
    { country: 'TW', value: '22099131', expect: /台灣積體電路/, source: 'tw-gcis' },
    { country: 'IL', value: '520043613', expect: /ISRAEL RAILWAYS/i, source: 'il-registrar' },
    { country: 'VN', value: '0100109106', expect: /VIỄN THÔNG QUÂN ĐỘI/, source: 'vn-tax-code' },
    { country: 'CO', value: '900373115', expect: /VIA BOGOTA/i, source: 'co-rues' },
  ];

  it.each(cases)('$country resolves through $source', async ({ country, value, expect: pattern, source }) => {
    const result = await service.lookup({ countryCode: country, value });
    const failure = failures.get(source);
    if (failure && result.source !== source) {
      const outage = await transientOutage(source, failure);
      if (outage) return reportUnavailable(outage);
    }
    expect(result.error).toBeUndefined();
    expect(result.found).toBe(true);
    expect(result.source).toBe(source);
    expect(result.company?.name).toMatch(pattern);
    expect(result.company?.countryCode).toBe(country);
  });

  it('validates an EU VAT number through VIES', async () => {
    const result = await service.lookup({ countryCode: 'IT', value: 'IT00159560366', scheme: 'VAT' });
    // VIES rate-limits per member state; a saturated MS is reported, never silently swallowed.
    if (result.error === 'PROVIDER_ERROR') {
      console.warn(`VIES unavailable: ${result.message}`);
      return;
    }
    expect(result.found).toBe(true);
    expect(result.source).toBe('eu-vies');
    expect(result.company?.VAT).toBe('IT00159560366');
    expect(result.company?.vatRegistered).toBe(true);
  });

  it('falls back to the GLEIF index for a country with no register API', async () => {
    // Bloomberg Finance L.P. — a US entity, reachable by its LEI with no key at all.
    const result = await service.lookup({ countryCode: 'US', value: '5493001KJTIIGC8Y1R12' });
    if (result.error === 'PROVIDER_ERROR' && isTimeout(result.message)) {
      return reportUnavailable(`gleif: ${result.message}`);
    }
    expect(result.error).toBeUndefined();
    expect(result.found).toBe(true);
    expect(result.source).toBe('gleif');
    expect(result.company?.name).toMatch(/Bloomberg/i);
  });

  it('completes a non-disclosing VIES answer from GLEIF', async () => {
    const result = await service.lookup({ countryCode: 'DE', value: 'DE811115368', scheme: 'VAT' });
    if (result.error === 'PROVIDER_ERROR') {
      console.warn(`VIES unavailable: ${result.message}`);
      return;
    }
    expect(result.found).toBe(true);
    // Germany hides the name in VIES, so the answer must come back enriched.
    expect(result.sources?.[0]).toBe('eu-vies');
    expect(result.company?.VAT).toBe('DE811115368');
    expect(result.company?.name).not.toBe('DE811115368');
  });

  it('finds a Peppol participant through the public directory', async () => {
    let company: Awaited<ReturnType<PeppolDirectoryProvider['lookup']>>;
    try {
      company = await new PeppolDirectoryProvider().lookup({
        countryCode: 'DK',
        scheme: 'LEGAL_ID',
        value: '25313763',
      });
    } catch (err) {
      if (err instanceof ProviderLookupError && isTimeout(err.message)) {
        return reportUnavailable(`peppol-directory: ${err.message}`);
      }
      throw err;
    }
    expect(company?.name).toMatch(/Arla/i);
  });
});

/** Matches the message `http.ts` gives an aborted request. */
function isTimeout(message: string | undefined): boolean {
  return /^Registry timed out after \d+ms$/.test(message ?? '');
}

/**
 * An outage this nightly run should report rather than fail on: a registry that did not answer in
 * time, or cvrapi.dk refusing the runner's IP once its free quota is spent (a 403 whose body says
 * QUOTA_EXCEEDED, re-read here because the provider only keeps the status line). Any other failure,
 * and any wrong data, still fails the test.
 */
async function transientOutage(providerId: string, failure: string): Promise<string | null> {
  if (isTimeout(failure)) return `${providerId}: ${failure}`;
  if (providerId === 'dk-cvr' && /^Registry responded 403\b/.test(failure)) {
    try {
      const res = await fetch('https://cvrapi.dk/api?search=25313763&country=dk', {
        headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(8000),
      });
      const body = (await res.json()) as { error?: string };
      if (body.error === 'QUOTA_EXCEEDED') return `${providerId}: cvrapi.dk quota exceeded for this IP`;
    } catch {
      // An unreadable body proves nothing about the quota: let the assertions decide.
    }
  }
  return null;
}

/** Same treatment as a saturated VIES member state: visible in the log and, on Actions, as a warning. */
function reportUnavailable(message: string): void {
  console.warn(`Registry unavailable: ${message}`);
  if (process.env.GITHUB_ACTIONS === 'true') {
    process.stdout.write(`::warning title=Registry unavailable::${message}\n`);
  }
}
