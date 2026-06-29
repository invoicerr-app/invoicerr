/**
 * §7 buyer routing via directory — unit tests.
 *
 * Tests:
 *   - AfnorDirectoryLookup resolves an Enabled entry → returns endpointId.
 *   - AfnorDirectoryLookup returns null when no Enabled entries.
 *   - AfnorDirectoryLookup returns null when the client throws (offline-safe).
 *   - SmpBuyerDirectory resolves a registered participant → endpointId.
 *   - SmpBuyerDirectory returns null when participant is not registered.
 *   - NullBuyerDirectory always returns null.
 */
import { AfnorDirectoryLookup } from './pdp/afnor-directory-lookup';
import { SmpBuyerDirectory } from './peppol/smp-buyer-directory';
import { NullBuyerDirectory } from './buyer-directory-port';
import type { DirectoryLineSearchResult } from './pdp/pdp-client';
import type { SmpLookupPort } from './peppol/smp-client';

// ---------------------------------------------------------------------------
// AfnorDirectoryLookup
// ---------------------------------------------------------------------------

describe('AfnorDirectoryLookup', () => {
  function makeClient(result: DirectoryLineSearchResult) {
    return {
      searchDirectoryLines: jest.fn().mockResolvedValue(result),
    };
  }

  const ENABLED_WK_ENTRY = {
    addressingIdentifier: '315143296_1422',
    siren: '315143296',
    siret: '31514329600012',
    platformType: 'WK' as const,
    directoryLineStatus: 'Enabled' as const,
    routingIdentifier: '315143296_1422',
  };

  it('resolves an Enabled WK entry by SIREN', async () => {
    const client = makeClient({ results: [ENABLED_WK_ENTRY], totalNumberOfResults: 1 });
    const lookup = new AfnorDirectoryLookup(client);

    const result = await lookup.lookup({ identifier: '315143296', scheme: 'SIREN' });

    expect(result).not.toBeNull();
    expect(result?.endpointId).toBe('315143296_1422');
    expect(result?.metadata?.platformType).toBe('WK');
    expect(client.searchDirectoryLines).toHaveBeenCalledWith({ siren: '315143296' }, 5);
  });

  it('resolves an Enabled entry by SIRET (14 digits)', async () => {
    const client = makeClient({ results: [ENABLED_WK_ENTRY], totalNumberOfResults: 1 });
    const lookup = new AfnorDirectoryLookup(client);

    const result = await lookup.lookup({ identifier: '31514329600012' });
    expect(result?.endpointId).toBe('315143296_1422');
    expect(client.searchDirectoryLines).toHaveBeenCalledWith({ siret: '31514329600012' }, 5);
  });

  it('auto-detects SIREN from 9-digit identifier', async () => {
    const client = makeClient({ results: [ENABLED_WK_ENTRY], totalNumberOfResults: 1 });
    const lookup = new AfnorDirectoryLookup(client);

    await lookup.lookup({ identifier: '315143296' });
    expect(client.searchDirectoryLines).toHaveBeenCalledWith({ siren: '315143296' }, 5);
  });

  it('returns null when no Enabled entries exist', async () => {
    const disabled = { ...ENABLED_WK_ENTRY, directoryLineStatus: 'Disabled' as const };
    const client = makeClient({ results: [disabled], totalNumberOfResults: 1 });
    const lookup = new AfnorDirectoryLookup(client);

    const result = await lookup.lookup({ identifier: '315143296', scheme: 'SIREN' });
    expect(result).toBeNull();
  });

  it('returns null when the directory is empty', async () => {
    const client = makeClient({ results: [], totalNumberOfResults: 0 });
    const lookup = new AfnorDirectoryLookup(client);

    const result = await lookup.lookup({ identifier: '315143296', scheme: 'SIREN' });
    expect(result).toBeNull();
  });

  it('returns null (offline-safe) when the client throws', async () => {
    const client = {
      searchDirectoryLines: jest.fn().mockRejectedValue(new Error('network error')),
    };
    const lookup = new AfnorDirectoryLookup(client);

    const result = await lookup.lookup({ identifier: '315143296', scheme: 'SIREN' });
    expect(result).toBeNull();
  });

  it('returns null for non-French identifiers (wrong length)', async () => {
    const client = makeClient({ results: [ENABLED_WK_ENTRY], totalNumberOfResults: 1 });
    const lookup = new AfnorDirectoryLookup(client);

    const result = await lookup.lookup({ identifier: 'IT12345678901' }); // Italian VAT, 13 chars
    expect(result).toBeNull();
    expect(client.searchDirectoryLines).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// SmpBuyerDirectory
// ---------------------------------------------------------------------------

describe('SmpBuyerDirectory', () => {
  function makeSmp(result: Awaited<ReturnType<SmpLookupPort['lookup']>>): SmpLookupPort {
    return { lookup: jest.fn().mockResolvedValue(result) };
  }

  const SMP_RESULT = {
    endpoint: {
      url: 'https://ap.example.com/as4',
      transportProfile: 'peppol-transport-as4-v2_0',
      serviceActivationDate: '2025-01-01',
    },
    documentTypeIds: ['urn:oasis:names:specification:ubl:schema:xsd:Invoice-2::Invoice##...'],
  };

  it('resolves a registered participant by Peppol ID', async () => {
    const smp = makeSmp(SMP_RESULT);
    const dir = new SmpBuyerDirectory(smp);

    const result = await dir.lookup({ identifier: '0009:12345678900011', scheme: 'PEPPOL_ID' });

    expect(result).not.toBeNull();
    expect(result?.endpointId).toBe('0009:12345678900011');
    expect(result?.metadata?.apEndpointUrl).toBe('https://ap.example.com/as4');
    expect(smp.lookup).toHaveBeenCalledWith(
      { icd: '0009', identifier: '12345678900011' },
      expect.any(String),
      'TEST',
    );
  });

  it('returns null when participant is not registered', async () => {
    const smp = makeSmp(null);
    const dir = new SmpBuyerDirectory(smp);

    const result = await dir.lookup({ identifier: '0009:99999999999999' });
    expect(result).toBeNull();
  });

  it('returns null (offline-safe) when SMP throws', async () => {
    const smp: SmpLookupPort = { lookup: jest.fn().mockRejectedValue(new Error('DNS timeout')) };
    const dir = new SmpBuyerDirectory(smp);

    const result = await dir.lookup({ identifier: '0009:12345678900011' });
    expect(result).toBeNull();
  });

  it('returns null for identifiers without icd:id separator', async () => {
    const smp = makeSmp(SMP_RESULT);
    const dir = new SmpBuyerDirectory(smp);

    const result = await dir.lookup({ identifier: 'badinput' });
    expect(result).toBeNull();
    expect(smp.lookup).not.toHaveBeenCalled();
  });

  it('passes the environment to SMP lookup', async () => {
    const smp = makeSmp(SMP_RESULT);
    const dir = new SmpBuyerDirectory(smp);

    await dir.lookup({ identifier: '0009:12345678900011', environment: 'PROD' });
    expect(smp.lookup).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(String),
      'PROD',
    );
  });
});

// ---------------------------------------------------------------------------
// NullBuyerDirectory
// ---------------------------------------------------------------------------

describe('NullBuyerDirectory', () => {
  it('always returns null', async () => {
    const dir = new NullBuyerDirectory();
    expect(await dir.lookup({ identifier: '315143296', scheme: 'SIREN' })).toBeNull();
    expect(await dir.lookup({ identifier: '0009:12345678900011', scheme: 'PEPPOL_ID' })).toBeNull();
  });
});
