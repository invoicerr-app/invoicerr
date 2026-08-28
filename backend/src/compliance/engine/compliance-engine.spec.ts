import { PartyRole, SupplyType } from '../types';
import { PartyTaxProfile, TransactionContext } from '../canonical/canonical-document';
import { primaryObligation, resolve } from './compliance-engine';

function party(country: string, role: PartyRole, validatedVat = role === 'B2B'): PartyTaxProfile {
  return {
    legalName: `${country} Co`,
    countryCode: country,
    role,
    identifiers: validatedVat ? [{ scheme: 'VAT', value: `${country}1`, validated: true }] : [],
  };
}

function tx(
  supplierCountry: string,
  buyerCountry: string,
  role: PartyRole,
  supplyType: SupplyType,
  issueDate: string,
): TransactionContext {
  return {
    supplier: party(supplierCountry, 'B2B'),
    buyer: party(buyerCountry, role),
    lines: [{ id: 'l1', description: 'x', quantity: 1, unitNetMinor: 10000, supplyType }],
    issueDate: new Date(issueDate),
    currency: 'EUR',
  };
}

describe('ComplianceEngine — France, temporal correctness', () => {
  it('FR→FR B2B AFTER the 2026 mandate: decentralized CTC, PDP channel, Factur-X, mandatory statuses', () => {
    const plan = resolve(tx('FR', 'FR', 'B2B', 'SERVICES', '2027-01-15'));
    expect(primaryObligation(plan).model).toBe('DECENTRALIZED_CTC');
    expect(primaryObligation(plan).blocking).toBe(false);
    expect(plan.channels.map((c) => c.type)).toContain('PDP');
    // Post-mandate FR: the AUTHORITATIVE e-invoice sent to the PDP is the CII XML (CTC
    // post-processing applies); the human/buyer copy is the Factur-X PDF/A-3 hybrid.
    expect(plan.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'AUTHORITATIVE', syntax: 'EN16931_CII' }),
        expect.objectContaining({ role: 'HUMAN', syntax: 'FACTURX' }),
      ]),
    );
    expect(plan.lifecycle.immutableAfter).toBe('ISSUE');
    expect(plan.lifecycle.response?.statuses).toContain('encaissée');
    expect(plan.archival.integrity).toBe('HASH_CHAIN');
    expect(plan.archival.retentionYears).toBe(10);
    expect(plan.confidence).toBe('OFFICIAL');
  });

  it('FR→FR B2B BEFORE the mandate: post-audit, email only, no mandatory statuses', () => {
    const plan = resolve(tx('FR', 'FR', 'B2B', 'SERVICES', '2025-06-01'));
    expect(primaryObligation(plan).model).toBe('POST_AUDIT');
    expect(plan.channels.map((c) => c.type)).toEqual(['EMAIL']);
    expect(plan.lifecycle.response).toBeUndefined();
  });

  it('FR→FR B2C after the mandate: real-time reporting (e-reporting)', () => {
    const plan = resolve(tx('FR', 'FR', 'B2C', 'SERVICES', '2027-01-15'));
    expect(primaryObligation(plan).model).toBe('REAL_TIME_REPORTING');
    expect(plan.reporting).toContain('E_REPORTING');
  });

  it('FR→FR B2B after the mandate does NOT carry B2C e-reporting', () => {
    const plan = resolve(tx('FR', 'FR', 'B2B', 'SERVICES', '2027-01-15'));
    expect(plan.reporting).not.toContain('E_REPORTING');
  });
});

describe('ComplianceEngine — P2-T02/T03: the attachment trigger routes the four French flows', () => {
  /**
   * The defect this pins, and it was the critical path of the whole plan: FR→IT and FR→US resolved
   * to DECENTRALIZED_CTC and were handed a PDP channel, where CGI art. 289 bis I reserves
   * e-invoicing to parties BOTH attached to France and art. 290 I 1° puts those supplies under
   * e-reporting (Légifrance, consulted 2026-08-28 — docs/compliance/FR-RATTACHEMENT.md).
   *
   * Wrong in both directions: an e-invoice was emitted where the law asks for a data transmission,
   * and the data transmission that IS owed was not emitted.
   */
  it('FR→FR B2B domestic: e-invoicing, PDP channel', () => {
    const plan = resolve(tx('FR', 'FR', 'B2B', 'SERVICES', '2027-01-15'));
    expect(primaryObligation(plan).model).toBe('DECENTRALIZED_CTC');
    expect(plan.channels.map((c) => c.type)).toContain('PDP');
  });

  it('FR→IT B2B services: e-reporting, and NO PDP — it used to get both wrong', () => {
    const plan = resolve(tx('FR', 'IT', 'B2B', 'SERVICES', '2027-01-15'));
    expect(primaryObligation(plan).model).toBe('REAL_TIME_REPORTING');
    expect(plan.channels.map((c) => c.type)).not.toContain('PDP');
  });

  it('FR→IT B2B goods: excluded twice over — bilateral test AND art. 289 bis V', () => {
    const plan = resolve(tx('FR', 'IT', 'B2B', 'GOODS', '2027-01-15'));
    expect(primaryObligation(plan).model).toBe('REAL_TIME_REPORTING');
    expect(plan.channels.map((c) => c.type)).not.toContain('PDP');
  });

  it('FR→US B2B export: e-reporting, no PDP', () => {
    const plan = resolve(tx('FR', 'US', 'B2B', 'GOODS', '2027-01-15'));
    expect(primaryObligation(plan).model).toBe('REAL_TIME_REPORTING');
    expect(plan.channels.map((c) => c.type)).not.toContain('PDP');
  });

  it('before the mandate, a domestic FR B2B operation is untouched by the predicate', () => {
    const plan = resolve(tx('FR', 'FR', 'B2B', 'SERVICES', '2025-06-01'));
    expect(primaryObligation(plan).model).toBe('POST_AUDIT');
    expect(plan.channels.map((c) => c.type)).toEqual(['EMAIL']);
  });

  /**
   * A profile that carries no attachment predicate must behave exactly as before — the migration is
   * opt-in, one country at a time, and nothing else may shift underneath it.
   */
  it("an unmigrated profile is unaffected: PL→DE still resolves Poland's regime", () => {
    const plan = resolve(tx('PL', 'DE', 'B2B', 'GOODS', '2027-01-15'));
    expect(primaryObligation(plan).model).toBe('CLEARANCE');
  });
});

describe('ComplianceEngine — cross-border composition', () => {
  it('US→FR B2B: US post-audit supplier, FR buyer drives a Factur-X receive artifact', () => {
    const plan = resolve(tx('US', 'FR', 'B2B', 'SERVICES', '2027-01-15'));
    expect(primaryObligation(plan).model).toBe('POST_AUDIT');
    expect(plan.classification.crossBorder).toBe(true);
    expect(plan.tax.buyerSelfAssess).toBe(true);
    expect(plan.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'AUTHORITATIVE', syntax: 'PLAIN_PDF' }),
        expect.objectContaining({ role: 'BUYER', syntax: 'FACTURX' }),
      ]),
    );
  });

  it('FR→US goods: export reporting flag surfaces in the plan', () => {
    const plan = resolve(tx('FR', 'US', 'B2B', 'GOODS', '2027-01-15'));
    expect(plan.reporting).toContain('CUSTOMS_EXPORT');
    expect(plan.confidence).toBe('OFFICIAL');
  });

  it('FR→IT B2B services: reverse charge; both profiles implemented → OFFICIAL confidence', () => {
    const plan = resolve(tx('FR', 'IT', 'B2B', 'SERVICES', '2027-01-15'));
    expect(plan.reporting).toContain('EC_SALES_LIST');
    expect(plan.tax.mentions.map((m) => m.code)).toContain('REVERSE_CHARGE');
    expect(plan.confidence).toBe('OFFICIAL');
    expect(plan.warnings.join(' ')).not.toMatch(/buyer country "IT"/);
  });
});

describe('ComplianceEngine — F-7: Peppol channel × artifact crossing (buildArtifacts)', () => {
  it('DE (primary XRECHNUNG) declares PEPPOL and gets a PEPPOL_BIS artifact added', () => {
    const plan = resolve(tx('DE', 'DE', 'B2B', 'GOODS', '2027-01-15'));
    expect(plan.channels.map((c) => c.type)).toContain('PEPPOL');
    expect(plan.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'AUTHORITATIVE', syntax: 'XRECHNUNG' }),
        expect.objectContaining({ syntax: 'PEPPOL_BIS' }),
      ]),
    );
  });

  it('ES (primary ES_FACTURAE) declares PEPPOL and gets a PEPPOL_BIS artifact added', () => {
    const plan = resolve(tx('ES', 'ES', 'B2B', 'GOODS', '2027-01-15'));
    expect(plan.channels.map((c) => c.type)).toContain('PEPPOL');
    expect(plan.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'AUTHORITATIVE', syntax: 'ES_FACTURAE' }),
        expect.objectContaining({ syntax: 'PEPPOL_BIS' }),
      ]),
    );
  });

  it('FR (primary EN16931_CII, already Peppol-transmittable) is NOT bloated with a duplicate', () => {
    const plan = resolve(tx('FR', 'FR', 'B2B', 'SERVICES', '2027-01-15'));
    expect(plan.channels.map((c) => c.type)).toContain('PEPPOL');
    const peppolCompatible = plan.artifacts.filter((a) =>
      ['PEPPOL_BIS', 'EN16931_UBL', 'EN16931_CII'].includes(a.syntax),
    );
    // Exactly one Peppol-transmittable syntax (the pre-existing EN16931_CII) — no PEPPOL_BIS added.
    expect(peppolCompatible).toHaveLength(1);
    expect(plan.artifacts.some((a) => a.syntax === 'PEPPOL_BIS')).toBe(false);
  });

  it('AT (postAudit archetype, primary EN16931_UBL, already Peppol-transmittable) is NOT bloated', () => {
    const plan = resolve(tx('AT', 'AT', 'B2B', 'SERVICES', '2027-01-15'));
    expect(plan.channels.map((c) => c.type)).toContain('PEPPOL');
    const peppolCompatible = plan.artifacts.filter((a) =>
      ['PEPPOL_BIS', 'EN16931_UBL', 'EN16931_CII'].includes(a.syntax),
    );
    expect(peppolCompatible).toHaveLength(1);
  });

  it('PL (no PEPPOL channel — KSeF only) does NOT get a PEPPOL_BIS artifact', () => {
    const plan = resolve(tx('PL', 'PL', 'B2B', 'GOODS', '2027-01-15'));
    expect(plan.channels.map((c) => c.type)).not.toContain('PEPPOL');
    expect(plan.artifacts.some((a) => a.syntax === 'PEPPOL_BIS')).toBe(false);
  });
});

describe('ComplianceEngine — delegation & fail-safe', () => {
  it('Monaco delegates to the French profile', () => {
    const plan = resolve(tx('MC', 'MC', 'B2B', 'SERVICES', '2027-01-15'));
    expect(plan.supplier.country).toBe('FR');
    expect(plan.supplier.delegatedFrom).toBe('MC');
    expect(primaryObligation(plan).model).toBe('DECENTRALIZED_CTC');
  });

  it('Unknown buyer country falls back safely with a visible warning', () => {
    const plan = resolve(tx('FR', 'ZZ', 'B2B', 'SERVICES', '2027-01-15'));
    expect(plan.confidence).toBe('FALLBACK');
    expect(plan.warnings.join(' ')).toMatch(/ZZ/);
  });
});
