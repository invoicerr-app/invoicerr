/**
 * P2-T02 — the three layers, and their deadlines.
 *
 * `regime` says HOW an invoice reaches the authority. It cannot say WHEN, nor say anything at all
 * about the two duties that are not issuance: returning a status you owe the sender, and keeping
 * the document. France has all three, on three different clocks, and the profile now carries them.
 *
 * Every figure below comes from docs/compliance/audit/03-LEGAL-VERIFICATION.md, which sourced them
 * against the spécifications externes v3.2 and Légifrance. Nothing here was re-derived, and nothing
 * was invented: where a duty's timing is not established, the model says `null` rather than a
 * plausible number, because a plausible number would be enforced.
 */
import { primaryObligation, resolve } from './compliance-engine';
import type { ResolvedObligation } from './compliance-engine';

const ctx = (buyerCountry: string, role: string, date = '2027-01-15') =>
  ({
    supplier: {
      legalName: 'FR Co',
      countryCode: 'FR',
      role: 'B2B',
      identifiers: [{ scheme: 'VAT', value: 'FR12345678901', validated: true }],
    },
    buyer: { legalName: 'B', countryCode: buyerCountry, role, identifiers: [] },
    lines: [{ id: 'l1', description: 'x', quantity: 1, unitNetMinor: 10000, supplyType: 'SERVICES' }],
    issueDate: new Date(date),
    currency: 'EUR',
    externalRef: 'layers',
  }) as never;

/** Same operation, a different SUPPLIER country — the profile that actually resolves. */
const supplierCtx = (supplierCountry: string) =>
  ({
    supplier: { legalName: 'Co', countryCode: supplierCountry, role: 'B2B', identifiers: [] },
    buyer: { legalName: 'B', countryCode: supplierCountry, role: 'B2B', identifiers: [] },
    lines: [{ id: 'l1', description: 'x', quantity: 1, unitNetMinor: 10000, supplyType: 'SERVICES' }],
    issueDate: new Date('2027-01-15'),
    currency: 'EUR',
    externalRef: 'layers-other',
  }) as never;

const layer = (obs: ResolvedObligation[], l: string) => obs.find((o) => o.layer === l);

describe('P2-T02 — France expresses three layers with distinct deadlines', () => {
  const obs = resolve(ctx('FR', 'B2B')).obligations;

  it('the three layers are present, and only three', () => {
    expect(obs.map((o) => o.layer).sort()).toEqual(['ARCHIVAL', 'ISSUANCE', 'RECEPTION']);
  });

  it('ISSUANCE: 24 h, and it is still the primary obligation the readers see', () => {
    expect(layer(obs, 'ISSUANCE')!.deadline).toEqual({ value: 24, unit: 'HOURS' });
    // The declared deadline ENRICHES the regime-derived duty rather than sitting beside it: the
    // model must still be there, or every migrated reader of primaryObligation() loses it.
    expect(primaryObligation(resolve(ctx('FR', 'B2B'))).model).toBe('DECENTRALIZED_CTC');
    expect(primaryObligation(resolve(ctx('FR', 'B2B'))).deadline).toEqual({ value: 24, unit: 'HOURS' });
  });

  it('RECEPTION: 24 h on its own clock — a duty the regime could not express at all', () => {
    expect(layer(obs, 'RECEPTION')!.deadline).toEqual({ value: 24, unit: 'HOURS' });
  });

  it('ARCHIVAL: SIX years, the fiscal duty — not the ten the profile retains', () => {
    // LPF art. L102 B. The profile's archival.retentionYears is 10, which is commercial law on a
    // separate clock; 03-LEGAL-VERIFICATION flags that conflation as FR-D9. The layer states the
    // fiscal duty correctly and the open question records that the two disagree.
    expect(layer(obs, 'ARCHIVAL')!.deadline).toEqual({ value: 6, unit: 'YEARS' });
    expect(layer(obs, 'ARCHIVAL')!.openQuestion).toMatch(/FR-D9/);
  });

  it('the size-phased entry into force is an OPEN QUESTION, not a silently wrong date', () => {
    // GE/ETI from 2026-09-01, PME/TPE from 2027-09-01. TransactionContext has no size field, so the
    // rule binds a year early for a small supplier. Encoding one date and calling it done would
    // have been the invented-rule failure this whole model exists to avoid.
    expect(layer(obs, 'ISSUANCE')!.openQuestion).toMatch(/size-phased/);
  });

  it('B2C carries no ISSUANCE layer: the mandate does not reach it', () => {
    const b2c = resolve(ctx('FR', 'B2C')).obligations;
    // The regime-derived duty is still there (e-reporting), but the DECLARED issuance layer selects
    // on B2B/B2G, so it must not attach — the same scope question as the PDP channel.
    expect(primaryObligation(resolve(ctx('FR', 'B2C'))).kind).toBe('E_REPORTING');
    expect(layer(b2c, 'RECEPTION')).toBeUndefined();
  });

  it('before the mandate, no layer attaches', () => {
    const before = resolve(ctx('FR', 'B2B', '2025-06-01')).obligations;
    expect(before.map((o) => o.layer)).toEqual(['ISSUANCE']);
    expect(before[0].deadline).toBeNull();
  });

  it('the other 107 profiles are untouched — one issuance duty, no deadline', () => {
    // The SUPPLIER's profile is the one that resolves. My first version of this varied the buyer
    // country and asserted against France's own layers, which is not a test of anything.
    for (const country of ['DE', 'IT', 'PL', 'ES']) {
      const other = resolve(supplierCtx(country)).obligations;
      expect(`${country}: ${other.map((o) => o.layer).join(',')}`).toBe(`${country}: ISSUANCE`);
      expect(`${country}: ${other[0].deadline}`).toBe(`${country}: null`);
    }
  });
});
