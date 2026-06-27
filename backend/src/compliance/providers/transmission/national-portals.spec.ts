import { RecordingComplianceLogger } from '../../execution/logger';
import { NATIONAL_PORTAL_PROVIDERS } from './national-portals';
import { defaultTransmissionRegistry } from './registry';

describe('national transmission portals', () => {
  it('every portal resolves by its providerId (no collision with the channel default)', () => {
    for (const p of NATIONAL_PORTAL_PROVIDERS) {
      expect(defaultTransmissionRegistry.resolve({ type: p.channel, providerId: p.id })?.id).toBe(p.id);
    }
  });

  it('a bare GOV_PORTAL_API channel still defaults to gov-portal', () => {
    expect(defaultTransmissionRegistry.resolve({ type: 'GOV_PORTAL_API' })?.id).toBe('gov-portal');
  });

  it('an unknown providerId falls back to the channel default', () => {
    expect(defaultTransmissionRegistry.resolve({ type: 'GOV_PORTAL_API', providerId: 'nope' })?.id).toBe('gov-portal');
  });

  it('clearance portals are ASYNC_POLL with a poll policy and expose poll()', async () => {
    const log = new RecordingComplianceLogger();
    for (const id of ['sefaz', 'sii', 'afip', 'zatca', 'in-irp', 'gib', 'anaf']) {
      const p = defaultTransmissionRegistry.getById(id)!;
      expect(p.feedback).toBe('ASYNC_POLL');
      expect(p.pollPolicy).toBeDefined();
      expect((await p.transmit([], {} as never, {} as never, 'k', log)).status).toBe('PENDING');
      expect(p.poll).toBeDefined();
      expect(p.poll!('ref', log).status).toBe('PENDING');
    }
  });

  it('real-time/report portals are fire-and-forget (NONE feedback, SENT)', async () => {
    const log = new RecordingComplianceLogger();
    for (const id of ['ke-kra', 'es-aeat', 'ph-bir']) {
      const p = defaultTransmissionRegistry.getById(id)!;
      expect(p.feedback).toBe('NONE');
      expect((await p.transmit([], {} as never, {} as never, 'k', log)).status).toBe('SENT');
    }
  });

  it('portal ids are unique and never shadow a hand-written provider', () => {
    const ids = NATIONAL_PORTAL_PROVIDERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const reserved of ['email', 'peppol', 'pdp', 'pac', 'sdi', 'gov-portal', 'ksef', 'ose', 'print']) {
      expect(ids).not.toContain(reserved);
    }
  });
});
