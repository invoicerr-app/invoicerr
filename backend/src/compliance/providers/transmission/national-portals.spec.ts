import { RecordingComplianceLogger } from '../../execution/logger';
import { NATIONAL_PORTAL_PROVIDERS } from './national-portals';
import { defaultTransmissionRegistry } from './registry';

describe('national transmission portals', () => {
  it('every portal resolves by its providerId', () => {
    for (const p of NATIONAL_PORTAL_PROVIDERS) {
      expect(defaultTransmissionRegistry.resolve({ type: p.channel, providerId: p.id })?.id).toBe(p.id);
    }
  });

  it('a bare GOV_PORTAL_API channel (no providerId) resolves to null — no generic fallback', () => {
    expect(defaultTransmissionRegistry.resolve({ type: 'GOV_PORTAL_API' })).toBeNull();
  });

  it('an unknown providerId for GOV_PORTAL_API resolves to null (no channel fallback)', () => {
    expect(defaultTransmissionRegistry.resolve({ type: 'GOV_PORTAL_API', providerId: 'nope' })).toBeNull();
  });

  it('clearance portals are ASYNC_POLL with a poll policy and expose poll()', async () => {
    const log = new RecordingComplianceLogger();
    for (const id of ['sefaz', 'sii', 'afip', 'zatca', 'in-irp', 'gib', 'anaf', 'choruspro']) {
      const p = defaultTransmissionRegistry.getById(id)!;
      expect(p.feedback).toBe('ASYNC_POLL');
      expect(p.pollPolicy).toBeDefined();
      expect((await p.transmit([], {} as never, {} as never, 'k', log)).status).toBe('PENDING');
      expect(p.poll).toBeDefined();
      expect((await p.poll!('ref', log)).status).toBe('PENDING');
    }
  });

  it('real-time/report portals are fire-and-forget (NONE feedback, SENT)', async () => {
    const log = new RecordingComplianceLogger();
    for (const id of ['ke-kra', 'es-aeat', 'ph-bir', 'gr-aade', 'hu-nav']) {
      const p = defaultTransmissionRegistry.getById(id)!;
      expect(p.feedback).toBe('NONE');
      expect((await p.transmit([], {} as never, {} as never, 'k', log)).status).toBe('SENT');
    }
  });

  it('portal ids are unique and never shadow a hand-written provider', () => {
    const ids = NATIONAL_PORTAL_PROVIDERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const reserved of ['email', 'peppol', 'pdp', 'pac', 'sdi', 'ksef', 'ose', 'print']) {
      expect(ids).not.toContain(reserved);
    }
  });

  it('choruspro is registered and is a GOV_PORTAL_API clearance portal', () => {
    const p = defaultTransmissionRegistry.getById('choruspro')!;
    expect(p).toBeDefined();
    expect(p.channel).toBe('GOV_PORTAL_API');
    expect(p.feedback).toBe('ASYNC_POLL');
  });
});
