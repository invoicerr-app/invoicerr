/**
 * Data-integrity guard for `TransmissionProvider.maturity` (COMPLIANCE_AUDIT.md F-8 / M-16 / M-18
 * "channel honesty"). `maturity` is the field the frontend uses to decide whether a channel's
 * Connect UI should be offered at all (channels.settings.tsx) — if a real, registered provider
 * were missing it, it would silently default to STUB (safe) but that's a smell worth catching
 * explicitly rather than relying on the fallback.
 *
 * This test is the single source of truth check: every id below is asserted against the classification
 * described in COMPLIANCE_AUDIT.md and README/compliance-handoff notes (PROVEN = real live
 * round-trip; IMPLEMENTED = real named-protocol client, no live proof yet; STUB = no real
 * transport for that specific authority).
 */
import { defaultTransmissionRegistry } from './registry';

// The 37-country generic-portal tier (europe + mena + latam + africa + asia "smaller portals").
// Every one of these is built via buildGenericPortalProvider(), which is STUB by construction —
// no httpPort is ever injected in prod (5 regional build* files + compliance.module.ts).
const GENERIC_PORTAL_IDS = [
  // Europe (10)
  'ua-dps',
  'me-fiscal',
  'hr-fiskalizacija',
  'al-cis',
  'lv-vid',
  'sk-financnasprava',
  'rs-sef',
  'es-aeat',
  'gr-aade',
  'hu-nav',
  // MENA (2)
  'jofotara',
  'tn-ttn',
  // LATAM (8)
  'cr-hacienda',
  'dgii',
  'gt-sat',
  'pa-dgi',
  'sifen',
  'sv-mh',
  'seniat',
  'bo-sin',
  // Africa (8)
  'gh-gra',
  'rw-rra',
  'tz-tra',
  'ug-ura',
  'zm-zra',
  'zw-zimra',
  'ci-dgi',
  'bj-dgi',
  // Asia (9)
  'tw-mof',
  'kz-isesf',
  'ph-bir',
  'th-rd',
  'np-ird',
  'bd-nbr',
  'pk-fbr',
  'cn-sta',
  'vn-gdt',
];

// Dedicated national-portal clients: real named-protocol scaffolding for ONE specific authority,
// just missing live credentials or an accreditation process.
const IMPLEMENTED_IDS = [
  'sdi',
  'choruspro',
  'es-face',
  'anaf',
  'gib',
  'eg-eta',
  'afip',
  'sii',
  'uy-dgi',
  'sefaz',
  'sri',
  'dian',
  'ke-kra',
  'firs',
  'myinvois',
  'id-coretax',
  'in-irp',
];

// Meta-abstractions with no single real target authority (PAC/OSE model an interchangeable
// vendor market, not one protocol) + the pure log.todo zatca stub + the non-delivering print stub.
const OTHER_STUB_IDS = ['pac', 'ose', 'print', 'zatca'];

const PROVEN_IDS = ['ksef', 'pdp', 'peppol', 'email'];

describe('TransmissionProvider maturity — data integrity (COMPLIANCE_AUDIT.md F-8/M-16/M-18)', () => {
  const providers = defaultTransmissionRegistry.allProviders();

  it('every registered provider declares an explicit maturity', () => {
    const missing = providers.filter((p) => !p.maturity).map((p) => p.id);
    expect(missing).toEqual([]);
  });

  it('the 3 PROVEN-critical channels (ksef/pdp/peppol) are marked PROVEN', () => {
    for (const id of ['ksef', 'pdp', 'peppol']) {
      expect(defaultTransmissionRegistry.getById(id)?.maturity).toBe('PROVEN');
    }
  });

  it('email is marked PROVEN (real SMTP send, proven live)', () => {
    expect(defaultTransmissionRegistry.getById('email')?.maturity).toBe('PROVEN');
  });

  it('every generic-portal tier entry (37 countries) is a STUB', () => {
    expect(GENERIC_PORTAL_IDS).toHaveLength(37);
    for (const id of GENERIC_PORTAL_IDS) {
      const p = defaultTransmissionRegistry.getById(id);
      expect(p).toBeDefined();
      expect(p?.maturity).toBe('STUB');
    }
  });

  it('zatca, pac, ose, print are STUB', () => {
    for (const id of OTHER_STUB_IDS) {
      const p = defaultTransmissionRegistry.getById(id);
      expect(p).toBeDefined();
      expect(p?.maturity).toBe('STUB');
    }
  });

  it('dedicated national-portal clients with real named-protocol scaffolding are IMPLEMENTED', () => {
    for (const id of IMPLEMENTED_IDS) {
      const p = defaultTransmissionRegistry.getById(id);
      expect(p).toBeDefined();
      expect(p?.maturity).toBe('IMPLEMENTED');
    }
  });

  it('classification lists + registry are exhaustive and non-overlapping', () => {
    const classified = [...PROVEN_IDS, ...IMPLEMENTED_IDS, ...OTHER_STUB_IDS, ...GENERIC_PORTAL_IDS];
    expect(new Set(classified).size).toBe(classified.length); // no id classified twice
    const registeredIds = providers.map((p) => p.id).sort();
    expect(classified.sort()).toEqual(registeredIds);
  });
});
