import { RecordingComplianceLogger } from '../../execution/logger';
import { RenderedArtifact } from '../../execution/types';
import { SignAlgo } from './signing-provider';
import { defaultSigningRegistry, resolveTimestampOptions } from './registry';
import { HttpTsaClient, NullTsaClient } from './tsa-client';

const artifact: RenderedArtifact = {
  role: 'AUTHORITATIVE',
  syntax: 'FACTURX',
  mime: 'application/xml',
  bytes: new Uint8Array(),
};

describe('SigningProviderRegistry', () => {
  it('returns the provider for each algorithm', () => {
    for (const algo of ['XAdES', 'CAdES', 'PAdES', 'none'] as SignAlgo[]) {
      expect(defaultSigningRegistry.get(algo).algo).toBe(algo);
    }
  });

  it('defaults an unknown algorithm to none', () => {
    expect(defaultSigningRegistry.get('UNKNOWN' as SignAlgo).algo).toBe('none');
  });

  it('signers without a credentials port warn and pass through unsigned (no-cert path)', async () => {
    // The defaultSigningRegistry uses NullSigningCredentials — all signers should
    // warn and return the artifact unsigned.
    const log = new RecordingComplianceLogger();
    const signed = await defaultSigningRegistry.get('XAdES').sign(artifact, 'CSD', log);
    expect(signed.signature).toBeUndefined();
    expect(log.entries.some((e) => e.level === 'warn' && e.scope === 'signing/xades')).toBe(true);
  });

  it('the none signer is a pass-through (no signature, no log)', async () => {
    const log = new RecordingComplianceLogger();
    const signed = await defaultSigningRegistry.get('none').sign(artifact, 'irrelevant', log);
    expect(signed.signature).toBeUndefined();
    expect(log.entries).toHaveLength(0);
  });

  it('CAdES no-cert pass-through', async () => {
    const log = new RecordingComplianceLogger();
    const signed = await defaultSigningRegistry.get('CAdES').sign(artifact, 'CSD', log);
    expect(signed.signature).toBeUndefined();
    expect(log.entries.some((e) => e.level === 'warn' && e.scope === 'signing/cades')).toBe(true);
  });

  it('PAdES no-cert pass-through', async () => {
    const log = new RecordingComplianceLogger();
    const signed = await defaultSigningRegistry.get('PAdES').sign(artifact, 'CSD', log);
    expect(signed.signature).toBeUndefined();
    expect(log.entries.some((e) => e.level === 'warn' && e.scope === 'signing/pades')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolveTimestampOptions — env-var wiring unit tests (no network, no certs)
// ---------------------------------------------------------------------------
describe('resolveTimestampOptions — TSA_URL env-var wiring', () => {
  it('returns BES + NullTsaClient when TSA_URL is absent', () => {
    const opts = resolveTimestampOptions({});
    expect(opts.signatureLevel).toBe('BES');
    expect(opts.tsa).toBeInstanceOf(NullTsaClient);
  });

  it('returns BES + NullTsaClient when TSA_URL is empty string', () => {
    const opts = resolveTimestampOptions({ TSA_URL: '' });
    expect(opts.signatureLevel).toBe('BES');
    expect(opts.tsa).toBeInstanceOf(NullTsaClient);
  });

  it('returns BES + NullTsaClient when TSA_URL is whitespace-only', () => {
    const opts = resolveTimestampOptions({ TSA_URL: '   ' });
    expect(opts.signatureLevel).toBe('BES');
    expect(opts.tsa).toBeInstanceOf(NullTsaClient);
  });

  it('returns T + HttpTsaClient when TSA_URL is set', () => {
    const opts = resolveTimestampOptions({ TSA_URL: 'https://freetsa.org/tsr' });
    expect(opts.signatureLevel).toBe('T');
    expect(opts.tsa).toBeInstanceOf(HttpTsaClient);
  });

  it('honours SIGNATURE_LEVEL override (LT) when TSA_URL is set', () => {
    const opts = resolveTimestampOptions({ TSA_URL: 'https://freetsa.org/tsr', SIGNATURE_LEVEL: 'LT' });
    expect(opts.signatureLevel).toBe('LT');
    expect(opts.tsa).toBeInstanceOf(HttpTsaClient);
  });

  it('ignores SIGNATURE_LEVEL when TSA_URL is absent — always BES (no TSA = no level)', () => {
    const opts = resolveTimestampOptions({ SIGNATURE_LEVEL: 'T' });
    expect(opts.signatureLevel).toBe('BES');
    expect(opts.tsa).toBeInstanceOf(NullTsaClient);
  });
});
