import { CompanyLookupService } from './company-lookup.service';
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

function serviceWith(providers: CompanyRegistryProvider[], ttlMs = 60_000) {
  return new CompanyLookupService(new CompanyLookupRegistry(providers), ttlMs);
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
