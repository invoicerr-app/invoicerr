/**
 * Europe-national smaller portals — mocked / structural tests.
 *
 * Tests:
 *   - Provider count and uniqueness.
 *   - All portals use GOV_PORTAL_API channel.
 *   - configSchema presence (environment + identifier fields).
 *   - Clearance portals are ASYNC_POLL; real-time/reporting portals are NONE.
 *   - All portals return SKIPPED when no resolved config.
 *   - Async portals: poll() returns PENDING when no credentials port.
 *   - poll() handles malformed ref gracefully.
 *   - Real-time portals have no poll().
 *
 * Live integration deferred — no sandbox credentials available.
 */
import { RecordingComplianceLogger } from '../../../execution/logger';
import { EUROPE_PORTAL_PROVIDERS } from './europe-smaller-portals';

const ASYNC_PORTAL_IDS = ['ua-dps', 'hr-fiskalizacija', 'al-cis', 'rs-sef'];
const REALTIME_PORTAL_IDS = ['me-fiscal', 'lv-vid', 'sk-financnasprava', 'es-aeat', 'gr-aade', 'hu-nav'];

describe('Europe-national smaller portals (scaffold)', () => {
  const log = new RecordingComplianceLogger();

  it('has 10 Europe portal providers', () => {
    expect(EUROPE_PORTAL_PROVIDERS).toHaveLength(10);
  });

  it('all provider IDs are unique', () => {
    const ids = EUROPE_PORTAL_PROVIDERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all providers use GOV_PORTAL_API channel', () => {
    for (const p of EUROPE_PORTAL_PROVIDERS) {
      expect(p.channel).toBe('GOV_PORTAL_API');
    }
  });

  it('all providers declare a configSchema with at least environment field', () => {
    for (const p of EUROPE_PORTAL_PROVIDERS) {
      expect(p.configSchema?.fields.length).toBeGreaterThanOrEqual(2);
      const fieldNames = p.configSchema!.fields.map((f) => f.name);
      expect(fieldNames).toContain('environment');
    }
  });

  it('clearance (async) portals are ASYNC_POLL and expose poll()', () => {
    for (const id of ASYNC_PORTAL_IDS) {
      const p = EUROPE_PORTAL_PROVIDERS.find((x) => x.id === id)!;
      expect(p).toBeDefined();
      expect(p.feedback).toBe('ASYNC_POLL');
      expect(p.pollPolicy).toBeDefined();
      expect(p.poll).toBeDefined();
    }
  });

  it('real-time/reporting portals are NONE feedback and have no poll()', () => {
    for (const id of REALTIME_PORTAL_IDS) {
      const p = EUROPE_PORTAL_PROVIDERS.find((x) => x.id === id)!;
      expect(p).toBeDefined();
      expect(p.feedback).toBe('NONE');
      expect(p.poll).toBeUndefined();
    }
  });

  it('all providers return SKIPPED when no resolved config', async () => {
    for (const p of EUROPE_PORTAL_PROVIDERS) {
      const result = await p.transmit([], {} as never, {} as never, 'key', log, undefined);
      expect(result.status).toBe('SKIPPED');
      expect(result.notes.some((n) => n.includes(p.id))).toBe(true);
    }
  });

  it('async portals poll() returns PENDING when no credentials port', async () => {
    for (const id of ASYNC_PORTAL_IDS) {
      const p = EUROPE_PORTAL_PROVIDERS.find((x) => x.id === id)!;
      const result = await p.poll!('company1|submission-id', log);
      expect(result.status).toBe('PENDING');
    }
  });

  it('poll() handles malformed ref gracefully', async () => {
    const p = EUROPE_PORTAL_PROVIDERS.find((x) => x.id === 'ua-dps')!;
    const result = await p.poll!('malformed-ref-without-pipe', log);
    expect(result.status).toBe('PENDING');
  });

  describe('ua-dps', () => {
    it('is ASYNC_POLL for Ukraine DPS ЄРПН', () => {
      const p = EUROPE_PORTAL_PROVIDERS.find((x) => x.id === 'ua-dps')!;
      expect(p.feedback).toBe('ASYNC_POLL');
    });
    it('has ipn field in configSchema', () => {
      const p = EUROPE_PORTAL_PROVIDERS.find((x) => x.id === 'ua-dps')!;
      expect(p.configSchema!.fields.map((f) => f.name)).toContain('ipn');
    });
  });

  describe('me-fiscal', () => {
    it('is NONE (real-time) for Montenegro fiscalization', () => {
      const p = EUROPE_PORTAL_PROVIDERS.find((x) => x.id === 'me-fiscal')!;
      expect(p.feedback).toBe('NONE');
    });
    it('has pib and tcrCode in configSchema', () => {
      const p = EUROPE_PORTAL_PROVIDERS.find((x) => x.id === 'me-fiscal')!;
      const fields = p.configSchema!.fields.map((f) => f.name);
      expect(fields).toContain('pib');
      expect(fields).toContain('tcrCode');
    });
  });

  describe('hr-fiskalizacija', () => {
    it('is ASYNC_POLL for Croatia e-Račun CIS', () => {
      const p = EUROPE_PORTAL_PROVIDERS.find((x) => x.id === 'hr-fiskalizacija')!;
      expect(p.feedback).toBe('ASYNC_POLL');
    });
    it('has oib and businessPremise in configSchema', () => {
      const p = EUROPE_PORTAL_PROVIDERS.find((x) => x.id === 'hr-fiskalizacija')!;
      const fields = p.configSchema!.fields.map((f) => f.name);
      expect(fields).toContain('oib');
      expect(fields).toContain('businessPremise');
    });
  });

  describe('al-cis', () => {
    it('is ASYNC_POLL for Albania CIS', () => {
      const p = EUROPE_PORTAL_PROVIDERS.find((x) => x.id === 'al-cis')!;
      expect(p.feedback).toBe('ASYNC_POLL');
    });
    it('has nipt in configSchema', () => {
      const p = EUROPE_PORTAL_PROVIDERS.find((x) => x.id === 'al-cis')!;
      expect(p.configSchema!.fields.map((f) => f.name)).toContain('nipt');
    });
  });

  describe('es-aeat', () => {
    it('is NONE (reporting) for Spain AEAT SII', () => {
      const p = EUROPE_PORTAL_PROVIDERS.find((x) => x.id === 'es-aeat')!;
      expect(p.feedback).toBe('NONE');
    });
    it('has nif in configSchema', () => {
      const p = EUROPE_PORTAL_PROVIDERS.find((x) => x.id === 'es-aeat')!;
      expect(p.configSchema!.fields.map((f) => f.name)).toContain('nif');
    });
  });

  describe('gr-aade', () => {
    it('is NONE (RTIR) for Greece myDATA', () => {
      const p = EUROPE_PORTAL_PROVIDERS.find((x) => x.id === 'gr-aade')!;
      expect(p.feedback).toBe('NONE');
    });
    it('has afm and subscriptionKey in configSchema', () => {
      const p = EUROPE_PORTAL_PROVIDERS.find((x) => x.id === 'gr-aade')!;
      const fields = p.configSchema!.fields.map((f) => f.name);
      expect(fields).toContain('afm');
      expect(fields).toContain('subscriptionKey');
    });
  });

  describe('hu-nav', () => {
    it('is NONE (RTIR) for Hungary NAV Online Számla', () => {
      const p = EUROPE_PORTAL_PROVIDERS.find((x) => x.id === 'hu-nav')!;
      expect(p.feedback).toBe('NONE');
    });
    it('has adoszam and login in configSchema', () => {
      const p = EUROPE_PORTAL_PROVIDERS.find((x) => x.id === 'hu-nav')!;
      const fields = p.configSchema!.fields.map((f) => f.name);
      expect(fields).toContain('adoszam');
      expect(fields).toContain('login');
    });
  });

  describe('rs-sef', () => {
    it('is ASYNC_POLL for Serbia SEF', () => {
      const p = EUROPE_PORTAL_PROVIDERS.find((x) => x.id === 'rs-sef')!;
      expect(p.feedback).toBe('ASYNC_POLL');
    });
    it('has pib in configSchema', () => {
      const p = EUROPE_PORTAL_PROVIDERS.find((x) => x.id === 'rs-sef')!;
      expect(p.configSchema!.fields.map((f) => f.name)).toContain('pib');
    });
  });
});
