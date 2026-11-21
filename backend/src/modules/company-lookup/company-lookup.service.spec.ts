import { budgetFromEnv, CompanyLookupService, DEFAULT_LOOKUP_BUDGET_MS } from './company-lookup.service';
import { CompanyLookupCoverage } from './coverage/registry';
import { CompanyLookupRegistry } from './registry';
import {
  CompanyLookupCompany,
  CompanyLookupQuery,
  CompanyRegistryProvider,
  LookupScheme,
  ProviderLookupError,
} from './types';

class FakeProvider implements CompanyRegistryProvider {
  lookupCalls = 0;

  constructor(
    readonly id: string,
    private readonly opts: {
      countries: string[];
      schemes?: LookupScheme[];
      configured?: boolean;
      supports?: (q: CompanyLookupQuery) => boolean;
      answer?: CompanyLookupCompany | null;
      throws?: Error;
      credentialEnvVars?: string[];
      /** Never settles: a register that accepted the connection and then went silent. */
      hangs?: boolean;
      /** Answers after this many milliseconds. */
      delayMs?: number;
    },
  ) {}

  readonly identifierLabel = 'Fake identifier';
  get label() {
    return `fake:${this.id}`;
  }
  get countries() {
    return this.opts.countries;
  }
  get schemes(): readonly LookupScheme[] {
    return this.opts.schemes ?? ['LEGAL_ID'];
  }
  get credentialEnvVars() {
    return this.opts.credentialEnvVars ?? [];
  }
  isConfigured() {
    return this.opts.configured !== false;
  }
  supports(query: CompanyLookupQuery) {
    return this.opts.supports ? this.opts.supports(query) : true;
  }
  async lookup(): Promise<CompanyLookupCompany | null> {
    this.lookupCalls++;
    if (this.opts.hangs) return new Promise<never>(() => undefined);
    if (this.opts.delayMs) await new Promise((resolve) => setTimeout(resolve, this.opts.delayMs));
    if (this.opts.throws) throw this.opts.throws;
    return this.opts.answer ?? null;
  }
}

// A complete answer: the service stops as soon as one source knows the name/address.
const acme: CompanyLookupCompany = {
  name: 'ACME',
  legalName: 'ACME s.r.o.',
  legalId: '1',
  legalIdScheme: 'X',
  city: 'Praha',
};

// The fakes' own country lists stand in for the lookup data.
function coverageOf(providers: FakeProvider[]): CompanyLookupCoverage {
  const facts: Record<string, { providers: string[] }> = {};
  for (const provider of providers) {
    for (const cc of provider.countries) {
      facts[cc] = { providers: [...(facts[cc]?.providers ?? []), provider.id] };
    }
  }
  return new CompanyLookupCoverage(facts);
}

function serviceWith(providers: FakeProvider[], ttlMs = 60_000, budgetMs?: number) {
  return new CompanyLookupService(
    new CompanyLookupRegistry(providers, coverageOf(providers)),
    ttlMs,
    budgetMs,
  );
}

describe('CompanyLookupService', () => {
  it('rejects a malformed country code or an empty identifier before any network call', async () => {
    const provider = new FakeProvider('p', { countries: ['FR'], answer: acme });
    const service = serviceWith([provider]);

    await expect(service.lookup({ countryCode: 'FRA', value: '1' })).resolves.toMatchObject({
      error: 'INVALID_IDENTIFIER',
    });
    await expect(service.lookup({ countryCode: 'FR', value: '  ' })).resolves.toMatchObject({
      error: 'INVALID_IDENTIFIER',
    });
    expect(provider.lookupCalls).toBe(0);
  });

  it('reports an unsupported country with the registry note', async () => {
    const service = serviceWith([]);
    const result = await service.lookup({ countryCode: 'US', value: '123' });
    expect(result).toMatchObject({ found: false, error: 'UNSUPPORTED_COUNTRY' });
    expect(result.message).toBeTruthy();
  });

  it('returns the first provider that finds the company and names its source', async () => {
    const national = new FakeProvider('nat', { countries: ['CZ'], answer: acme });
    const fallback = new FakeProvider('eu-vies', { countries: ['CZ'], schemes: ['VAT'], answer: acme });
    const service = serviceWith([national, fallback]);

    const result = await service.lookup({ countryCode: 'CZ', value: '45274649' });
    expect(result).toMatchObject({ found: true, source: 'nat', sourceLabel: 'fake:nat' });
    expect(result.company).toMatchObject({ name: 'ACME', countryCode: 'CZ', status: 'UNKNOWN' });
    expect(fallback.lookupCalls).toBe(0);
  });

  it('falls through to the next provider when the first one is not configured', async () => {
    const dormant = new FakeProvider('nat', { countries: ['GB'], configured: false, answer: acme });
    const other = new FakeProvider('other', { countries: ['GB'], answer: acme });
    const service = serviceWith([dormant, other]);

    await expect(service.lookup({ countryCode: 'GB', value: 'X' })).resolves.toMatchObject({
      source: 'other',
    });
    expect(dormant.lookupCalls).toBe(0);
  });

  it('tries the VAT scheme when the registration number scheme finds nothing', async () => {
    const legalId = new FakeProvider('legal', { countries: ['IT'], schemes: ['LEGAL_ID'], answer: null });
    const vat = new FakeProvider('vat', { countries: ['IT'], schemes: ['VAT'], answer: acme });
    const service = serviceWith([legalId, vat]);

    await expect(service.lookup({ countryCode: 'IT', value: '00159560366' })).resolves.toMatchObject({
      found: true,
      source: 'vat',
    });
  });

  it('honours an explicit scheme instead of trying both', async () => {
    const legalId = new FakeProvider('legal', { countries: ['IT'], schemes: ['LEGAL_ID'], answer: null });
    const vat = new FakeProvider('vat', { countries: ['IT'], schemes: ['VAT'], answer: acme });
    const service = serviceWith([legalId, vat]);

    await expect(
      service.lookup({ countryCode: 'IT', value: 'x', scheme: 'LEGAL_ID' }),
    ).resolves.toMatchObject({
      found: false,
    });
    expect(vat.lookupCalls).toBe(0);
  });

  it('explains a missing credential rather than pretending the company does not exist', async () => {
    const dormant = new FakeProvider('gb', {
      countries: ['GB'],
      configured: false,
      credentialEnvVars: ['COMPANIES_HOUSE_API_KEY'],
    });
    const result = await serviceWith([dormant]).lookup({ countryCode: 'GB', value: '00000006' });
    expect(result).toMatchObject({ error: 'NOT_CONFIGURED' });
    expect(result.message).toContain('COMPANIES_HOUSE_API_KEY');
  });

  it('explains a malformed identifier with the country prompt', async () => {
    const provider = new FakeProvider('fr', { countries: ['FR'], supports: () => false });
    const result = await serviceWith([provider]).lookup({ countryCode: 'FR', value: 'nope' });
    expect(result).toMatchObject({ error: 'INVALID_IDENTIFIER' });
    expect(result.message).toContain('Fake identifier');
  });

  it('surfaces a registry outage as PROVIDER_ERROR', async () => {
    const provider = new FakeProvider('fr', {
      countries: ['FR'],
      throws: new ProviderLookupError('PROVIDER_ERROR', 'Registry timed out after 8000ms'),
    });
    await expect(serviceWith([provider]).lookup({ countryCode: 'FR', value: '1' })).resolves.toMatchObject({
      error: 'PROVIDER_ERROR',
      message: /timed out/ as any,
    });
  });

  it('caches definitive answers but retries after a failure', async () => {
    const found = new FakeProvider('ok', { countries: ['CZ'], answer: acme });
    const service = serviceWith([found]);
    await service.lookup({ countryCode: 'CZ', value: '45274649' });
    await service.lookup({ countryCode: 'cz', value: '45274649' });
    expect(found.lookupCalls).toBe(1);

    const failing = new FakeProvider('ko', { countries: ['CZ'], throws: new Error('boom') });
    const failingService = serviceWith([failing]);
    await failingService.lookup({ countryCode: 'CZ', value: '1' });
    await failingService.lookup({ countryCode: 'CZ', value: '1' });
    expect(failing.lookupCalls).toBe(2);
  });

  it('expires cached answers after the TTL', async () => {
    const provider = new FakeProvider('ok', { countries: ['CZ'], answer: acme });
    const service = serviceWith([provider], 0);
    await service.lookup({ countryCode: 'CZ', value: '45274649' });
    await service.lookup({ countryCode: 'CZ', value: '45274649' });
    expect(provider.lookupCalls).toBe(2);
  });
});

describe('CompanyLookupService: total budget across the provider chain (#786)', () => {
  it('defaults to about five seconds', () => {
    expect(DEFAULT_LOOKUP_BUDGET_MS).toBe(5000);
  });

  it('gives up on a hanging register within the budget, with nothing pre-filled and no later provider asked', async () => {
    const hanging = new FakeProvider('fr', { countries: ['FR'], hangs: true });
    const next = new FakeProvider('gleif', { countries: ['FR'], answer: acme, delayMs: 500 });
    const service = serviceWith([hanging, next], 60_000, 100);

    const started = Date.now();
    const result = await service.lookup({ countryCode: 'FR', value: '55208131766522', scheme: 'LEGAL_ID' });
    const elapsed = Date.now() - started;

    expect(result).toMatchObject({ found: false, company: null, error: 'PROVIDER_ERROR', source: 'fr' });
    expect(result.message).toContain('100ms');
    expect(elapsed).toBeLessThan(1000);
    expect(next.lookupCalls).toBe(0);
  });

  it('shares one budget across providers instead of granting each its own', async () => {
    const slow = new FakeProvider('a', { countries: ['FR'], answer: null, delayMs: 80 });
    const hanging = new FakeProvider('b', { countries: ['FR'], hangs: true });
    const service = serviceWith([slow, hanging], 60_000, 150);

    const started = Date.now();
    const result = await service.lookup({ countryCode: 'FR', value: '1', scheme: 'LEGAL_ID' });

    expect(result).toMatchObject({ error: 'PROVIDER_ERROR', source: 'b' });
    expect(Date.now() - started).toBeLessThan(600);
  });

  it('still pre-fills from a fast register', async () => {
    const fast = new FakeProvider('fr', { countries: ['FR'], answer: acme, delayMs: 5 });
    const result = await serviceWith([fast], 60_000, 1000).lookup({ countryCode: 'FR', value: '1' });
    expect(result).toMatchObject({ found: true, source: 'fr' });
    expect(result.company).toMatchObject({ legalName: 'ACME s.r.o.', city: 'Praha' });
  });

  it('keeps what an earlier source found when the budget runs out on the next one', async () => {
    const partial = new FakeProvider('vies', { countries: ['FR'], answer: { name: 'ACME', VAT: 'FR1' } });
    const hanging = new FakeProvider('gleif', { countries: ['FR'], hangs: true });
    const result = await serviceWith([partial, hanging], 60_000, 100).lookup({
      countryCode: 'FR',
      value: '1',
      scheme: 'LEGAL_ID',
    });
    expect(result).toMatchObject({ found: true, source: 'vies' });
  });

  it('never caches a budget cut, so the next try asks the registers again', async () => {
    const hanging = new FakeProvider('fr', { countries: ['FR'], hangs: true });
    const service = serviceWith([hanging], 60_000, 50);
    await service.lookup({ countryCode: 'FR', value: '1', scheme: 'LEGAL_ID' });
    await service.lookup({ countryCode: 'FR', value: '1', scheme: 'LEGAL_ID' });
    expect(hanging.lookupCalls).toBe(2);
  });

  it('reads COMPANY_LOOKUP_BUDGET_MS as a positive integer and refuses anything else', () => {
    const warn = vi.fn();
    expect(budgetFromEnv(undefined, { warn })).toBeUndefined();
    expect(budgetFromEnv('', { warn })).toBeUndefined();
    expect(budgetFromEnv('3000', { warn })).toBe(3000);
    expect(budgetFromEnv('0', { warn })).toBeUndefined();
    expect(budgetFromEnv('-5', { warn })).toBeUndefined();
    expect(budgetFromEnv('2.5', { warn })).toBeUndefined();
    expect(budgetFromEnv('soon', { warn })).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(4);
  });
});
