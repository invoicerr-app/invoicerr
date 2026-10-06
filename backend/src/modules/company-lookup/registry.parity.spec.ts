import { ISO_COUNTRY_CODES } from './data/iso-countries';
import { buildDefaultProviders, CompanyLookupRegistry } from './registry';
import { noteText } from './note-text.test-fixtures';

const EXTRA_CODES = ['XI', 'QQ', '', 'fr', 'gr', 'gb', 'XYZ'];

const CREDENTIAL_VARS = [...new Set(buildDefaultProviders().flatMap((p) => p.credentialEnvVars ?? []))];

function withCredentials<T>(configured: boolean, run: () => T): T {
  const saved = Object.fromEntries(CREDENTIAL_VARS.map((name) => [name, process.env[name]]));
  for (const name of CREDENTIAL_VARS) {
    if (configured) process.env[name] = 'parity-test';
    else delete process.env[name];
  }
  try {
    return run();
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

function describeCountry(registry: CompanyLookupRegistry, code: string, configured: boolean) {
  return withCredentials(configured, () => {
    const capability = registry.capability(code);
    return { status: capability.status, coverage: capability.coverage, note: noteText(capability) };
  });
}

describe('CompanyLookupRegistry: resolved coverage is pinned for every country', () => {
  const registry = new CompanyLookupRegistry();

  it('resolves the same providers, in the same order, with the same notes', async () => {
    const resolved = [...ISO_COUNTRY_CODES, ...EXTRA_CODES].map((code) => ({
      code,
      providers: registry.forCountry(code).map((p) => p.id),
      withoutCredentials: describeCountry(registry, code, false),
      withCredentials: describeCountry(registry, code, true),
    }));
    await expect(`${JSON.stringify(resolved, null, 2)}\n`).toMatchFileSnapshot(
      './__snapshots__/registry.parity.resolved.snap',
    );
  });

  it('lists the same countries', async () => {
    const listed = registry.capabilities().map((capability) => capability.countryCode);
    await expect(`${JSON.stringify(listed)}\n`).toMatchFileSnapshot(
      './__snapshots__/registry.parity.countries.snap',
    );
  });
});
