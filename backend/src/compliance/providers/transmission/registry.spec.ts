import { TransmissionProviderRegistry } from './registry';

describe('TransmissionProviderRegistry — providerId resolution', () => {
  const reg = new TransmissionProviderRegistry();

  it('resolves a generic channel to its default provider', () => {
    expect(reg.resolve({ type: 'EMAIL' })?.id).toBe('email');
    expect(reg.resolve({ type: 'SDI' })?.id).toBe('sdi');
    expect(reg.resolve({ type: 'GOV_PORTAL_API' })?.id).toBe('gov-portal');
  });

  it('an explicit providerId wins over the generic channel default (no collision)', () => {
    expect(reg.resolve({ type: 'GOV_PORTAL_API', providerId: 'ksef' })?.id).toBe('ksef');
  });

  it('falls back to the channel default when the providerId is unknown', () => {
    expect(reg.resolve({ type: 'GOV_PORTAL_API', providerId: 'does-not-exist' })?.id).toBe('gov-portal');
  });

  it('exposes lookup by id', () => {
    expect(reg.getById('ksef')?.channel).toBe('GOV_PORTAL_API');
    expect(reg.getById('pac')?.channel).toBe('PAC');
    expect(reg.getById('nope')).toBeNull();
  });
});
