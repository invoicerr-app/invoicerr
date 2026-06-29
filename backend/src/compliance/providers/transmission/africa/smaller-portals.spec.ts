/**
 * Africa smaller portals — mocked / structural tests.
 *
 * Tests:
 *   - Every provider resolves by providerId.
 *   - Async (clearance) portals are ASYNC_POLL + expose poll().
 *   - Real-time portals are NONE feedback.
 *   - All portals return SKIPPED when no resolved config.
 *   - Provider IDs are unique among Africa smaller portals.
 *
 * Live integration deferred — no sandbox credentials available.
 */
import { RecordingComplianceLogger } from '../../../execution/logger';
import { SMALL_AFRICA_PROVIDERS } from './smaller-portals';

const ASYNC_PORTAL_IDS = ['gh-gra', 'rw-rra'];
const REALTIME_PORTAL_IDS = ['tz-tra', 'ug-ura', 'zm-zra', 'zw-zimra', 'ci-dgi', 'bj-dgi'];

describe('Africa smaller portals (scaffold)', () => {
  const log = new RecordingComplianceLogger();

  it('has 8 Africa smaller portal providers', () => {
    expect(SMALL_AFRICA_PROVIDERS).toHaveLength(8);
  });

  it('all provider IDs are unique', () => {
    const ids = SMALL_AFRICA_PROVIDERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all providers use GOV_PORTAL_API channel', () => {
    for (const p of SMALL_AFRICA_PROVIDERS) {
      expect(p.channel).toBe('GOV_PORTAL_API');
    }
  });

  it('all providers declare a configSchema with at least environment + identifier fields', () => {
    for (const p of SMALL_AFRICA_PROVIDERS) {
      expect(p.configSchema?.fields.length).toBeGreaterThanOrEqual(2);
      const fieldNames = p.configSchema!.fields.map((f) => f.name);
      expect(fieldNames).toContain('environment');
    }
  });

  it('clearance (async) portals are ASYNC_POLL and expose poll()', () => {
    for (const id of ASYNC_PORTAL_IDS) {
      const p = SMALL_AFRICA_PROVIDERS.find((x) => x.id === id)!;
      expect(p).toBeDefined();
      expect(p.feedback).toBe('ASYNC_POLL');
      expect(p.pollPolicy).toBeDefined();
      expect(p.poll).toBeDefined();
    }
  });

  it('real-time portals are NONE feedback and have no poll()', () => {
    for (const id of REALTIME_PORTAL_IDS) {
      const p = SMALL_AFRICA_PROVIDERS.find((x) => x.id === id)!;
      expect(p).toBeDefined();
      expect(p.feedback).toBe('NONE');
      expect(p.poll).toBeUndefined();
    }
  });

  it('all providers return SKIPPED when no resolved config', async () => {
    for (const p of SMALL_AFRICA_PROVIDERS) {
      const result = await p.transmit([], {} as never, {} as never, 'key', log, undefined);
      expect(result.status).toBe('SKIPPED');
      expect(result.notes.some((n) => n.includes(p.id))).toBe(true);
    }
  });

  it('async portals poll() returns PENDING when ref has no credentials port', async () => {
    for (const id of ASYNC_PORTAL_IDS) {
      const p = SMALL_AFRICA_PROVIDERS.find((x) => x.id === id)!;
      const result = await p.poll!('company1|submission-id', log);
      expect(result.status).toBe('PENDING');
    }
  });

  it('poll() handles malformed ref gracefully', async () => {
    const p = SMALL_AFRICA_PROVIDERS.find((x) => x.id === 'gh-gra')!;
    const result = await p.poll!('malformed-ref-without-pipe', log);
    expect(result.status).toBe('PENDING');
  });

  describe('gh-gra', () => {
    it('is clearance-style (ASYNC_POLL) for Ghana GRA eVAT', () => {
      const p = SMALL_AFRICA_PROVIDERS.find((x) => x.id === 'gh-gra')!;
      expect(p.feedback).toBe('ASYNC_POLL');
    });
  });

  describe('rw-rra', () => {
    it('is clearance-style (ASYNC_POLL) for Rwanda RRA EBM', () => {
      const p = SMALL_AFRICA_PROVIDERS.find((x) => x.id === 'rw-rra')!;
      expect(p.feedback).toBe('ASYNC_POLL');
    });
    it('has deviceSerial in configSchema', () => {
      const p = SMALL_AFRICA_PROVIDERS.find((x) => x.id === 'rw-rra')!;
      expect(p.configSchema!.fields.map((f) => f.name)).toContain('deviceSerial');
    });
  });

  describe('tz-tra', () => {
    it('is real-time (NONE feedback) for Tanzania TRA VFD', () => {
      const p = SMALL_AFRICA_PROVIDERS.find((x) => x.id === 'tz-tra')!;
      expect(p.feedback).toBe('NONE');
    });
    it('has gcn in configSchema (Global Certification Number)', () => {
      const p = SMALL_AFRICA_PROVIDERS.find((x) => x.id === 'tz-tra')!;
      expect(p.configSchema!.fields.map((f) => f.name)).toContain('gcn');
    });
  });

  describe('ug-ura', () => {
    it('is real-time (NONE feedback) for Uganda EFRIS', () => {
      const p = SMALL_AFRICA_PROVIDERS.find((x) => x.id === 'ug-ura')!;
      expect(p.feedback).toBe('NONE');
    });
  });

  describe('zm-zra', () => {
    it('is real-time (NONE feedback) for Zambia Smart Invoice', () => {
      const p = SMALL_AFRICA_PROVIDERS.find((x) => x.id === 'zm-zra')!;
      expect(p.feedback).toBe('NONE');
    });
    it('has deviceSerial in configSchema (VSDC)', () => {
      const p = SMALL_AFRICA_PROVIDERS.find((x) => x.id === 'zm-zra')!;
      expect(p.configSchema!.fields.map((f) => f.name)).toContain('deviceSerial');
    });
  });

  describe('zw-zimra', () => {
    it('is real-time (NONE feedback) for Zimbabwe FDMS', () => {
      const p = SMALL_AFRICA_PROVIDERS.find((x) => x.id === 'zw-zimra')!;
      expect(p.feedback).toBe('NONE');
    });
    it('has bpno in configSchema (Business Partner Number)', () => {
      const p = SMALL_AFRICA_PROVIDERS.find((x) => x.id === 'zw-zimra')!;
      expect(p.configSchema!.fields.map((f) => f.name)).toContain('bpno');
    });
  });

  describe('ci-dgi', () => {
    it('is real-time (NONE feedback) for Côte d\'Ivoire FNE', () => {
      const p = SMALL_AFRICA_PROVIDERS.find((x) => x.id === 'ci-dgi')!;
      expect(p.feedback).toBe('NONE');
    });
    it('has ncc in configSchema (Numéro de Compte Contribuable)', () => {
      const p = SMALL_AFRICA_PROVIDERS.find((x) => x.id === 'ci-dgi')!;
      expect(p.configSchema!.fields.map((f) => f.name)).toContain('ncc');
    });
  });

  describe('bj-dgi', () => {
    it('is real-time (NONE feedback) for Benin MECeF/SeMeF', () => {
      const p = SMALL_AFRICA_PROVIDERS.find((x) => x.id === 'bj-dgi')!;
      expect(p.feedback).toBe('NONE');
    });
    it('has ifu in configSchema (Identifiant Fiscal Unique)', () => {
      const p = SMALL_AFRICA_PROVIDERS.find((x) => x.id === 'bj-dgi')!;
      expect(p.configSchema!.fields.map((f) => f.name)).toContain('ifu');
    });
  });
});
