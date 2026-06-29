/**
 * MENA smaller portals — mocked / structural tests.
 *
 * Tests:
 *   - Provider count and uniqueness.
 *   - All portals use GOV_PORTAL_API channel.
 *   - configSchema presence (environment + identifier fields).
 *   - All portals are ASYNC_POLL (both JoFotara and TTN are clearance-style).
 *   - All portals return SKIPPED when no resolved config.
 *   - Async portals: poll() returns PENDING when no credentials port.
 *   - poll() handles malformed ref gracefully.
 *
 * Live integration deferred — no sandbox credentials available.
 */
import { RecordingComplianceLogger } from '../../../execution/logger';
import { SMALL_MENA_PROVIDERS } from './mena-smaller-portals';

describe('MENA smaller portals (scaffold)', () => {
  const log = new RecordingComplianceLogger();

  it('has 2 MENA smaller portal providers', () => {
    expect(SMALL_MENA_PROVIDERS).toHaveLength(2);
  });

  it('all provider IDs are unique', () => {
    const ids = SMALL_MENA_PROVIDERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all providers use GOV_PORTAL_API channel', () => {
    for (const p of SMALL_MENA_PROVIDERS) {
      expect(p.channel).toBe('GOV_PORTAL_API');
    }
  });

  it('all providers declare a configSchema with at least environment + identifier fields', () => {
    for (const p of SMALL_MENA_PROVIDERS) {
      expect(p.configSchema?.fields.length).toBeGreaterThanOrEqual(2);
      const fieldNames = p.configSchema!.fields.map((f) => f.name);
      expect(fieldNames).toContain('environment');
    }
  });

  it('all MENA portals are ASYNC_POLL (clearance-style)', () => {
    for (const p of SMALL_MENA_PROVIDERS) {
      expect(p.feedback).toBe('ASYNC_POLL');
      expect(p.pollPolicy).toBeDefined();
      expect(p.poll).toBeDefined();
    }
  });

  it('all providers return SKIPPED when no resolved config', async () => {
    for (const p of SMALL_MENA_PROVIDERS) {
      const result = await p.transmit([], {} as never, {} as never, 'key', log, undefined);
      expect(result.status).toBe('SKIPPED');
      expect(result.notes.some((n) => n.includes(p.id))).toBe(true);
    }
  });

  it('poll() returns PENDING when ref has no credentials port', async () => {
    for (const p of SMALL_MENA_PROVIDERS) {
      const result = await p.poll!('company1|submission-id', log);
      expect(result.status).toBe('PENDING');
    }
  });

  it('poll() handles malformed ref gracefully', async () => {
    for (const p of SMALL_MENA_PROVIDERS) {
      const result = await p.poll!('malformed-ref-without-pipe', log);
      expect(result.status).toBe('PENDING');
    }
  });

  describe('jofotara', () => {
    it('is registered with id "jofotara"', () => {
      const p = SMALL_MENA_PROVIDERS.find((x) => x.id === 'jofotara')!;
      expect(p).toBeDefined();
      expect(p.feedback).toBe('ASYNC_POLL');
    });
    it('has tin and merchantId in configSchema', () => {
      const p = SMALL_MENA_PROVIDERS.find((x) => x.id === 'jofotara')!;
      const fieldNames = p.configSchema!.fields.map((f) => f.name);
      expect(fieldNames).toContain('tin');
      expect(fieldNames).toContain('merchantId');
      expect(fieldNames).toContain('apiToken');
    });
  });

  describe('tn-ttn', () => {
    it('is registered with id "tn-ttn"', () => {
      const p = SMALL_MENA_PROVIDERS.find((x) => x.id === 'tn-ttn')!;
      expect(p).toBeDefined();
      expect(p.feedback).toBe('ASYNC_POLL');
    });
    it('has matriculeFiscal and ttnSubscriberId in configSchema', () => {
      const p = SMALL_MENA_PROVIDERS.find((x) => x.id === 'tn-ttn')!;
      const fieldNames = p.configSchema!.fields.map((f) => f.name);
      expect(fieldNames).toContain('matriculeFiscal');
      expect(fieldNames).toContain('ttnSubscriberId');
      expect(fieldNames).toContain('apiToken');
    });
  });
});
