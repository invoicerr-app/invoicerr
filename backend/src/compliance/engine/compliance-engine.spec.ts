import { PartyRole, SupplyType } from '../types';
import { PartyTaxProfile, TransactionContext } from '../canonical/canonical-document';
import { resolve } from './compliance-engine';

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
    expect(plan.regime.model).toBe('DECENTRALIZED_CTC');
    expect(plan.regime.blocking).toBe(false);
    expect(plan.channels.map((c) => c.type)).toContain('PDP');
    expect(plan.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'AUTHORITATIVE', syntax: 'FACTURX' }),
        expect.objectContaining({ role: 'HUMAN', syntax: 'PDF_A3' }),
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
    expect(plan.regime.model).toBe('POST_AUDIT');
    expect(plan.channels.map((c) => c.type)).toEqual(['EMAIL']);
    expect(plan.lifecycle.response).toBeUndefined();
  });

  it('FR→FR B2C after the mandate: real-time reporting (e-reporting)', () => {
    const plan = resolve(tx('FR', 'FR', 'B2C', 'SERVICES', '2027-01-15'));
    expect(plan.regime.model).toBe('REAL_TIME_REPORTING');
    expect(plan.reporting).toContain('E_REPORTING');
  });

  it('FR→FR B2B after the mandate does NOT carry B2C e-reporting', () => {
    const plan = resolve(tx('FR', 'FR', 'B2B', 'SERVICES', '2027-01-15'));
    expect(plan.reporting).not.toContain('E_REPORTING');
  });
});

describe('ComplianceEngine — cross-border composition', () => {
  it('US→FR B2B: US post-audit supplier, FR buyer drives a Factur-X receive artifact', () => {
    const plan = resolve(tx('US', 'FR', 'B2B', 'SERVICES', '2027-01-15'));
    expect(plan.regime.model).toBe('POST_AUDIT');
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

describe('ComplianceEngine — delegation & fail-safe', () => {
  it('Monaco delegates to the French profile', () => {
    const plan = resolve(tx('MC', 'MC', 'B2B', 'SERVICES', '2027-01-15'));
    expect(plan.supplier.country).toBe('FR');
    expect(plan.supplier.delegatedFrom).toBe('MC');
    expect(plan.regime.model).toBe('DECENTRALIZED_CTC');
  });

  it('Unknown buyer country falls back safely with a visible warning', () => {
    const plan = resolve(tx('FR', 'ZZ', 'B2B', 'SERVICES', '2027-01-15'));
    expect(plan.confidence).toBe('FALLBACK');
    expect(plan.warnings.join(' ')).toMatch(/ZZ/);
  });
});
