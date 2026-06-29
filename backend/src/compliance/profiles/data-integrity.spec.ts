/**
 * Profile data-integrity invariants. These guard the whole `profiles/data/` set against silent rot:
 * every wired profile must be well-formed, temporally ordered, with sane rates, and — crucially —
 * every DocumentSyntax and channel providerId it references must resolve to a REAL provider (a typo
 * would otherwise fall back to a catch-all and ship silently-wrong behaviour).
 */
import { ALL_PROFILES } from './data/all';
import { FALLBACK } from './data/fallback';
import { defaultRegistry } from './registry';
import { Temporal } from './schema';
import { defaultFormatRegistry } from '../providers/format/registry';
import { defaultTransmissionRegistry } from '../providers/transmission/registry';

const concrete = ALL_PROFILES.filter((p) => !p.delegatesTo);
const delegating = ALL_PROFILES.filter((p) => p.delegatesTo);

describe('profile data integrity', () => {
  it('there is a healthy number of wired jurisdictions', () => {
    expect(defaultRegistry.countries().length).toBeGreaterThanOrEqual(100);
  });

  it('every concrete profile is well-formed', () => {
    for (const p of concrete) {
      expect(p.countryCode).toMatch(/^[A-Z]{2}$/);
      expect(p.regime.length).toBeGreaterThan(0);
      expect(p.formats.length).toBeGreaterThan(0);
      expect(p.transmission.length).toBeGreaterThan(0);
      expect(p.lifecycle.length).toBeGreaterThan(0);
      expect(p.numbering.length).toBeGreaterThan(0);
      expect(p.taxSystem).toBeDefined();
      expect(['OFFICIAL', 'BEST_EFFORT', 'PLANNED', 'FALLBACK', 'UNVERIFIED']).toContain(p.confidence);
    }
  });

  it('VAT/GST rates are sane (every rate in 0..30)', () => {
    // Note: `reducedRates` is really "other rates" — some are ABOVE standard (e.g. AR 27% super-rate),
    // so we only bound the range, not the ordering.
    for (const p of concrete) {
      const t = p.taxSystem;
      if (t.kind === 'VAT' || t.kind === 'GST') {
        for (const r of [t.standardRate, ...(t.reducedRates ?? [])]) {
          expect(r).toBeGreaterThanOrEqual(0);
          expect(r).toBeLessThanOrEqual(30);
        }
      }
    }
  });

  it('every temporal rule list is chronologically ordered with valid dates', () => {
    const check = (entries: Temporal<unknown>[]) => {
      for (const e of entries) {
        expect(Number.isNaN(new Date(e.validFrom).getTime())).toBe(false);
        if (e.validTo) {
          expect(new Date(e.validTo).getTime()).toBeGreaterThan(new Date(e.validFrom).getTime());
        }
      }
      for (let i = 1; i < entries.length; i++) {
        expect(new Date(entries[i].validFrom).getTime()).toBeGreaterThanOrEqual(
          new Date(entries[i - 1].validFrom).getTime(),
        );
      }
    };
    for (const p of concrete) {
      check(p.regime); check(p.formats); check(p.transmission);
      check(p.lifecycle); check(p.archival); check(p.numbering); check(p.reporting);
    }
  });

  it('every delegating profile points at a real target', () => {
    expect(delegating.length).toBeGreaterThan(0);
    for (const p of delegating) expect(defaultRegistry.has(p.delegatesTo!)).toBe(true);
  });

  it('every referenced format syntax resolves to a format provider (no orphan syntax)', () => {
    for (const p of concrete) {
      for (const f of p.formats) {
        const syntaxes = [f.value.primary.syntax];
        if (f.value.human) syntaxes.push(f.value.human.syntax);
        for (const s of syntaxes) {
          expect({ country: p.countryCode, syntax: s, provider: defaultFormatRegistry.resolve(s)?.id ?? null }).toMatchObject({
            provider: expect.any(String),
          });
        }
      }
      if (p.mandatoryReceiveSyntax) {
        expect(defaultFormatRegistry.resolve(p.mandatoryReceiveSyntax)).not.toBeNull();
      }
    }
  });

  it('every referenced channel providerId resolves to that exact provider (no silent fallback)', () => {
    for (const p of concrete) {
      for (const t of p.transmission) {
        for (const ch of t.value.channels) {
          const provider = defaultTransmissionRegistry.resolve(ch);
          expect({ country: p.countryCode, channel: ch.type, providerId: ch.providerId, resolved: provider?.id ?? null }).toMatchObject({
            resolved: expect.any(String),
          });
          if (ch.providerId) expect(provider!.id).toBe(ch.providerId);
        }
      }
    }
  });

  it('every GOV_PORTAL_API channel in every profile carries a providerId (no bare generic portals)', () => {
    // Rule: GOV_PORTAL_API = centralized national portal topology. The *concrete* authority is
    // always named via providerId (ksef, sefaz, choruspro, …). A bare { type: GOV_PORTAL_API }
    // without a providerId is a configuration error — it resolves to null and is SKIPPED.
    const offenders: { country: string; rule: string }[] = [];
    for (const p of concrete) {
      for (const t of p.transmission) {
        for (const ch of t.value.channels) {
          if (ch.type === 'GOV_PORTAL_API' && !ch.providerId) {
            offenders.push({ country: p.countryCode, rule: `validFrom=${t.validFrom}` });
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('bespoke profiles win over archetype duplicates (FR/US/MX/IT/PL OFFICIAL)', () => {
    for (const cc of ['FR', 'US', 'MX', 'IT', 'PL']) {
      expect(defaultRegistry.resolve(cc).profile.confidence).toBe('OFFICIAL');
    }
  });

  describe('requiredIdentifiers', () => {
    it('every profile has a defined requiredIdentifiers array', () => {
      for (const p of ALL_PROFILES) {
        expect(Array.isArray(p.requiredIdentifiers)).toBe(true);
      }
    });

    it('every IdentifierRequirement is well-formed', () => {
      const validAppliesTo = ['COMPANY', 'INDIVIDUAL', 'BOTH'];
      for (const p of concrete) {
        for (const ri of p.requiredIdentifiers) {
          expect(ri.scheme).toMatch(/^[A-Z_]{2,20}$/);
          expect(typeof ri.label).toBe('string');
          expect(ri.label.length).toBeGreaterThan(0);
          expect(validAppliesTo).toContain(ri.appliesTo);
          expect(typeof ri.required).toBe('boolean');
        }
      }
    });

    it('bespoke OFFICIAL profiles (FR/MX/US/IT/PL) have non-empty requiredIdentifiers', () => {
      for (const cc of ['FR', 'MX', 'US', 'IT', 'PL']) {
        const p = defaultRegistry.resolve(cc).profile;
        expect(p.requiredIdentifiers.length).toBeGreaterThan(0);
      }
    });

    it('FALLBACK profile has empty requiredIdentifiers', () => {
      expect(FALLBACK.requiredIdentifiers).toEqual([]);
    });

    it('delegating profiles (e.g. MC) have empty requiredIdentifiers (their delegate owns them)', () => {
      for (const p of delegating) {
        expect(p.requiredIdentifiers).toEqual([]);
      }
    });
  });
});
