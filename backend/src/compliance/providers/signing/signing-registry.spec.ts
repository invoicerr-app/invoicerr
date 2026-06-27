import { RecordingComplianceLogger } from '../../execution/logger';
import { RenderedArtifact } from '../../execution/types';
import { SignAlgo } from './signing-provider';
import { defaultSigningRegistry } from './registry';

const artifact: RenderedArtifact = { role: 'AUTHORITATIVE', syntax: 'FACTURX', mime: 'application/xml', bytes: new Uint8Array() };

describe('SigningProviderRegistry', () => {
  it('returns the provider for each algorithm', () => {
    for (const algo of ['XAdES', 'CAdES', 'PAdES', 'none'] as SignAlgo[]) {
      expect(defaultSigningRegistry.get(algo).algo).toBe(algo);
    }
  });

  it('defaults an unknown algorithm to none', () => {
    expect(defaultSigningRegistry.get('UNKNOWN' as SignAlgo).algo).toBe('none');
  });

  it('a real signer attaches signature info (algo + certRef) and logs a TODO', () => {
    const log = new RecordingComplianceLogger();
    const signed = defaultSigningRegistry.get('XAdES').sign(artifact, 'CSD', log);
    expect(signed.signature).toEqual({ algo: 'XAdES', certRef: 'CSD' });
    expect(log.hasScope('signing/xades')).toBe(true);
  });

  it('the none signer is a pass-through (no signature, no TODO)', () => {
    const log = new RecordingComplianceLogger();
    const signed = defaultSigningRegistry.get('none').sign(artifact, 'irrelevant', log);
    expect(signed.signature).toBeUndefined();
    expect(log.entries).toHaveLength(0);
  });
});
