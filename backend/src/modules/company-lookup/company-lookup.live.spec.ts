/**
 * Live registry lookups — opt-in, real HTTP, no credentials.
 *
 *   COMPANY_LOOKUP_LIVE=1 npx jest company-lookup.live --no-coverage --runInBand
 *
 * Skipped by default (CI and offline runs). Only the keyless registers are covered:
 * every credentialed provider (GB, IE, NL, CH, AU) needs its env vars and is exercised
 * by its unit test instead. Each case queries a well-known public entity, so a failure
 * means the registry changed its contract — not that the data moved.
 */
import { CompanyLookupService } from './company-lookup.service';
import { PeppolDirectoryProvider } from './providers/peppol-directory.provider';
import { CompanyLookupRegistry } from './registry';

const live = process.env.COMPANY_LOOKUP_LIVE === '1';
const describeLive = live ? describe : describe.skip;

describeLive('company lookup — live registries', () => {
  const service = new CompanyLookupService(new CompanyLookupRegistry());

  jest.setTimeout(30_000);

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
    const company = await new PeppolDirectoryProvider().lookup({
      countryCode: 'DK',
      scheme: 'LEGAL_ID',
      value: '25313763',
    });
    expect(company?.name).toMatch(/Arla/i);
  });
});
