import { RecordingComplianceLogger } from '../../execution/logger';
import { RenderedArtifact } from '../../execution/types';
import { SignAlgo } from './signing-provider';
import { defaultSigningRegistry } from './registry';

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
