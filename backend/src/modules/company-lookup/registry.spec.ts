import { CompanyLookupRegistry, defaultLookupRegistry } from './registry';

describe('CompanyLookupRegistry', () => {
  const registry = defaultLookupRegistry;

  it('always explains itself: partial coverage carries a note', () => {
    for (const capability of registry.capabilities()) {
      if (capability.coverage === 'PARTIAL' || capability.status === 'UNAVAILABLE') {
        expect(capability.note).toBeTruthy();
      }
    }
  });

  it('tries the national register first, then VIES, then the worldwide directories', () => {
    expect(registry.forCountry('FR').map((p) => p.id)).toEqual([
      'fr-recherche-entreprises',
      'eu-vies',
      'gleif',
      'peppol-directory',
    ]);
    expect(registry.forCountry('cz').map((p) => p.id)).toEqual([
      'cz-ares',
      'eu-vies',
      'gleif',
      'peppol-directory',
    ]);
  });

  it('serves every country through the keyless worldwide directories', () => {
    for (const cc of ['US', 'MX', 'ZA', 'TH', 'ZW']) {
      const capability = registry.capability(cc);
      expect(capability.status).toBe('AVAILABLE');
      expect(capability.providers.map((p) => p.id)).toEqual(['gleif', 'peppol-directory']);
      expect(capability.providers.every((p) => p.requiresCredentials)).toBe(false);
    }
  });

  it('covers every EU member state through VIES at least', () => {
    for (const cc of [
      'AT',
      'BE',
      'BG',
      'HR',
      'CY',
      'CZ',
      'DK',
      'EE',
      'FI',
      'FR',
      'DE',
      'GR',
      'HU',
      'IE',
      'IT',
      'LV',
      'LT',
      'LU',
      'MT',
      'NL',
      'PL',
      'PT',
      'RO',
      'SK',
      'SI',
      'ES',
      'SE',
    ]) {
      expect(registry.capability(cc).status).toBe('AVAILABLE');
    }
  });

  it('falls back to partial coverage while a credentialed register is unconfigured', () => {
    delete process.env.COMPANIES_HOUSE_API_KEY;
    const without = registry.capability('GB');
    // The keyless directories still answer, so the button stays usable.
    expect(without.status).toBe('AVAILABLE');
    expect(without.coverage).toBe('PARTIAL');
    expect(without.providers[0].credentialEnvVars).toEqual(['COMPANIES_HOUSE_API_KEY']);

    process.env.COMPANIES_HOUSE_API_KEY = 'test-key';
    const withKey = registry.capability('GB');
    expect(withKey.status).toBe('AVAILABLE');
    expect(withKey.coverage).toBe('REGISTER');
    delete process.env.COMPANIES_HOUSE_API_KEY;
  });

  it('keeps explaining what a country without its own register can and cannot find', () => {
    const us = registry.capability('US');
    expect(us.coverage).toBe('PARTIAL');
    expect(us.note).toMatch(/federal business register/i);
    expect(us.note).toMatch(/GLEIF|Peppol/);
    // A malformed code resolves to nothing at all.
    expect(registry.capability('XYZ').status).toBe('UNAVAILABLE');
  });

  it('flags VIES-only countries so the UI can temper expectations', () => {
    expect(registry.capability('SE').note).toMatch(/VIES/);
    expect(registry.capability('DE').note).toMatch(/does not disclose names/i);
  });

  it('exposes the identifier prompt of the first usable provider', () => {
    expect(registry.capability('FR').identifierLabel).toMatch(/SIRET/);
    expect(registry.capability('PL').identifierLabel).toMatch(/NIP/);
  });

  it('can be built with a custom provider set', () => {
    const empty = new CompanyLookupRegistry([]);
    expect(empty.forCountry('FR')).toEqual([]);
    expect(empty.capability('FR').status).toBe('UNAVAILABLE');
  });

  it('reports every country as keyless-serviceable out of the box', () => {
    const needingKeys = registry
      .capabilities()
      .filter((c) => c.status !== 'AVAILABLE' || c.providers.filter((p) => p.configured).length === 0);
    expect(needingKeys).toEqual([]);
  });
});
