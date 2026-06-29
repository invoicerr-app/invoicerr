import { RecordingComplianceLogger } from '../../execution/logger';
import { TransmissionProviderRegistry } from './registry';

describe('TransmissionProviderRegistry — providerId resolution', () => {
  const reg = new TransmissionProviderRegistry();

  it('resolves typed channels to their default providers', () => {
    expect(reg.resolve({ type: 'EMAIL' })?.id).toBe('email');
    expect(reg.resolve({ type: 'SDI' })?.id).toBe('sdi');
    expect(reg.resolve({ type: 'PDP' })?.id).toBe('pdp');
  });

  it('a bare GOV_PORTAL_API spec (no providerId) resolves to null — there is no generic fallback', () => {
    expect(reg.resolve({ type: 'GOV_PORTAL_API' })).toBeNull();
  });

  it('an unknown providerId for GOV_PORTAL_API resolves to null (no channel fallback)', () => {
    expect(reg.resolve({ type: 'GOV_PORTAL_API', providerId: 'does-not-exist' })).toBeNull();
  });

  it('an explicit providerId wins: ksef resolves to the KSeF provider', () => {
    expect(reg.resolve({ type: 'GOV_PORTAL_API', providerId: 'ksef' })?.id).toBe('ksef');
  });

  it('named national portal providers resolve by their providerId', () => {
    expect(reg.resolve({ type: 'GOV_PORTAL_API', providerId: 'sefaz' })?.id).toBe('sefaz');
    expect(reg.resolve({ type: 'GOV_PORTAL_API', providerId: 'zatca' })?.id).toBe('zatca');
    expect(reg.resolve({ type: 'GOV_PORTAL_API', providerId: 'choruspro' })?.id).toBe('choruspro');
  });

  it('exposes lookup by id', () => {
    expect(reg.getById('ksef')?.channel).toBe('GOV_PORTAL_API');
    expect(reg.getById('pac')?.channel).toBe('PAC');
    expect(reg.getById('nope')).toBeNull();
    expect(reg.getById('gov-portal')).toBeNull(); // removed — no generic fallback
  });

  it('transmitAll emits SKIPPED with an explicit note for a bare GOV_PORTAL_API channel', async () => {
    const log = new RecordingComplianceLogger();
    const results = await reg.transmitAll(
      [],
      {} as never,
      { channels: [{ type: 'GOV_PORTAL_API' }] } as never,
      'test-key',
      log,
    );
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('SKIPPED');
    expect(results[0].notes?.[0]).toMatch(/GOV_PORTAL_API requires a providerId/);
  });
});
