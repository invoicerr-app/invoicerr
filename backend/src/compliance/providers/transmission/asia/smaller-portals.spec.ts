/**
 * Asia smaller portals — mocked / structural tests.
 *
 * Tests:
 *   - Every provider resolves by providerId in the registry.
 *   - Async (clearance) portals are ASYNC_POLL + expose poll().
 *   - Real-time portals are NONE feedback.
 *   - All portals return SKIPPED when no resolved config.
 *   - Provider IDs are unique among Asia portals.
 *
 * Live integration deferred — no sandbox credentials available.
 */
import { RecordingComplianceLogger } from '../../../execution/logger';
import { SMALL_ASIA_PROVIDERS } from './smaller-portals';

const ASYNC_PORTAL_IDS = ['tw-mof', 'kz-isesf', 'cn-sta', 'vn-gdt'];
const REALTIME_PORTAL_IDS = ['ph-bir', 'th-rd', 'np-ird', 'bd-nbr', 'pk-fbr'];

describe('Asia smaller portals (scaffold)', () => {
  const log = new RecordingComplianceLogger();

  it('has 9 Asia portal providers', () => {
    expect(SMALL_ASIA_PROVIDERS).toHaveLength(9);
  });

  it('all provider IDs are unique', () => {
    const ids = SMALL_ASIA_PROVIDERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all providers use GOV_PORTAL_API channel', () => {
    for (const p of SMALL_ASIA_PROVIDERS) {
      expect(p.channel).toBe('GOV_PORTAL_API');
    }
  });

  it('all providers declare a configSchema with at least environment + API token fields', () => {
    for (const p of SMALL_ASIA_PROVIDERS) {
      expect(p.configSchema?.fields.length).toBeGreaterThanOrEqual(2);
      const fieldNames = p.configSchema!.fields.map((f) => f.name);
      expect(fieldNames).toContain('environment');
    }
  });

  it('clearance (async) portals are ASYNC_POLL and expose poll()', () => {
    for (const id of ASYNC_PORTAL_IDS) {
      const p = SMALL_ASIA_PROVIDERS.find((x) => x.id === id)!;
      expect(p).toBeDefined();
      expect(p.feedback).toBe('ASYNC_POLL');
      expect(p.pollPolicy).toBeDefined();
      expect(p.poll).toBeDefined();
    }
  });

  it('real-time portals are NONE feedback and have no poll()', () => {
    for (const id of REALTIME_PORTAL_IDS) {
      const p = SMALL_ASIA_PROVIDERS.find((x) => x.id === id)!;
      expect(p).toBeDefined();
      expect(p.feedback).toBe('NONE');
      expect(p.poll).toBeUndefined();
    }
  });

  it('all providers return SKIPPED when no resolved config', async () => {
    for (const p of SMALL_ASIA_PROVIDERS) {
      const result = await p.transmit([], {} as never, {} as never, 'key', log, undefined);
      expect(result.status).toBe('SKIPPED');
      expect(result.notes.some((n) => n.includes(p.id))).toBe(true);
    }
  });

  it('async portals poll() returns PENDING when ref has no credentials port', async () => {
    for (const id of ASYNC_PORTAL_IDS) {
      const p = SMALL_ASIA_PROVIDERS.find((x) => x.id === id)!;
      const result = await p.poll!('company1|submission-id', log);
      expect(result.status).toBe('PENDING');
    }
  });

  it('poll() handles malformed ref gracefully', async () => {
    const p = SMALL_ASIA_PROVIDERS.find((x) => x.id === 'tw-mof')!;
    const result = await p.poll!('malformed-ref-without-pipe', log);
    expect(result.status).toBe('PENDING');
  });

  describe('tw-mof', () => {
    it('has Taiwan MoF eGUI as label and TW_EGUI artifact', () => {
      const p = SMALL_ASIA_PROVIDERS.find((x) => x.id === 'tw-mof')!;
      expect(p.feedback).toBe('ASYNC_POLL');
    });
  });

  describe('kz-isesf', () => {
    it('is clearance-style (ASYNC_POLL)', () => {
      const p = SMALL_ASIA_PROVIDERS.find((x) => x.id === 'kz-isesf')!;
      expect(p.feedback).toBe('ASYNC_POLL');
    });
  });

  describe('ph-bir', () => {
    it('is real-time (NONE feedback)', () => {
      const p = SMALL_ASIA_PROVIDERS.find((x) => x.id === 'ph-bir')!;
      expect(p.feedback).toBe('NONE');
    });
  });

  describe('vn-gdt', () => {
    it('is clearance-style (ASYNC_POLL) for the mã CQT', () => {
      const p = SMALL_ASIA_PROVIDERS.find((x) => x.id === 'vn-gdt')!;
      expect(p.feedback).toBe('ASYNC_POLL');
    });
  });

  describe('cn-sta', () => {
    it('is clearance-style (ASYNC_POLL) for Golden Tax IV e-Fapiao', () => {
      const p = SMALL_ASIA_PROVIDERS.find((x) => x.id === 'cn-sta')!;
      expect(p.feedback).toBe('ASYNC_POLL');
    });
  });
});
