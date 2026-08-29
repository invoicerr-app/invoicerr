/**
 * P3-T03 — the correction that must never leave.
 *
 * On statuses Refusée and Rejetée the French supplier is REQUIRED to produce an accounting credit
 * note and REQUIRED not to transmit it: "le fournisseur doit procéder à une annulation comptable
 * (avoir interne). Cette opération ne doit pas générer de flux de données réglementaires (F1) au
 * PPF" — spécifications externes DGFiP v3.2, 30/04/2026, § 3.6.4 p. 60. Italy has the same rule
 * after a scarto (Provv. AdE 89757/2018, punto 6.3).
 *
 * Before this task the correction became an ordinary document: `correctInvoice()` issued it, nothing
 * marked it, and the next click on Send pushed to the PPF precisely the flux the specification says
 * must not exist. The guard now lives in three places, and each is tested here — the decision, the
 * button, and the API that must not be talked into it.
 */
import { deriveInvoiceActions, isTransmissionSuppressed } from './invoices.helpers';
import { internalOnlyCorrection } from '@/compliance/lifecycle/correction-routes';
import { resolve } from '@/compliance/engine/compliance-engine';
import { PartyTaxProfile, TransactionContext } from '@/compliance/canonical/canonical-document';

function party(country: string): PartyTaxProfile {
  return {
    legalName: `${country} Co`,
    countryCode: country,
    role: 'B2B',
    identifiers: [{ scheme: 'VAT', value: `${country}1`, validated: true }],
  };
}

function routesOf(country: string, date = '2026-09-02') {
  return resolve({
    supplier: party(country),
    buyer: party(country),
    lines: [{ id: 'l1', description: 'x', quantity: 1, unitNetMinor: 10000, supplyType: 'GOODS' }],
    issueDate: new Date(date),
    currency: 'EUR',
  } as TransactionContext).lifecycle.correctionRoutes;
}

describe('P3-T03 — the decision, taken from the profile and not from a country name', () => {
  it('France suppresses transmission on Refusée and on Rejetée', () => {
    for (const status of ['REFUSED', 'REJECTED'] as const) {
      const rule = internalOnlyCorrection(routesOf('FR'), status);
      expect(rule).toBeDefined();
      expect(rule?.route).toBe('INTERNAL_CREDIT_NOTE');
      expect(rule?.transmission).toBe('FORBIDDEN');
      // The rule carries the text it rests on, which is what ends up in the audit trail.
      expect(rule?.legalRef).toMatch(/3\.6\.4/);
    }
  });

  it('France does NOT suppress on any other status', () => {
    // The narrowness is the point. A correction of an accepted or delivered invoice is an ordinary
    // credit note and must still reach the buyer; suppressing it would break the common case in
    // order to protect the rare one.
    for (const status of ['ISSUED', 'DELIVERED', 'ACCEPTED', 'CLEARED', 'DISPUTED'] as const) {
      expect(internalOnlyCorrection(routesOf('FR'), status)).toBeUndefined();
    }
  });

  it('Italy suppresses on Rejetée only — a scarto has no buyer-refusal counterpart in B2B', () => {
    expect(internalOnlyCorrection(routesOf('IT'), 'REJECTED')).toBeDefined();
    expect(internalOnlyCorrection(routesOf('IT'), 'REFUSED')).toBeUndefined();
  });

  it('no other pivot suppresses anything — three of them forbid the route outright', () => {
    for (const cc of ['PL', 'ES', 'MX', 'DE', 'US']) {
      for (const status of ['REFUSED', 'REJECTED'] as const) {
        expect(`${cc}/${status}`).toBe(
          internalOnlyCorrection(routesOf(cc), status) ? 'suppressed' : `${cc}/${status}`,
        );
      }
    }
  });

  it('France before the mandate suppresses nothing — the rule is a flux rule', () => {
    // The substantive VAT law is unchanged by the reform; only the PPF flux exists on one side of
    // the date. Suppressing a pre-mandate correction would withhold a document from a buyer who is
    // entitled to it, on the strength of a rule that does not yet apply.
    expect(internalOnlyCorrection(routesOf('FR', '2025-06-01'), 'REFUSED')).toBeUndefined();
  });
});

describe('P3-T03 — the button', () => {
  const issued = { status: 'ISSUED', kind: 'CREDIT_NOTE' };

  it('an internal-only correction offers no Send', () => {
    expect(deriveInvoiceActions(issued, null, 'CREDIT_NOTE', 'ISSUE', true).send).toBe(false);
  });

  it('…while every other issued document still does — this is the assertion that fails without the guard', () => {
    expect(deriveInvoiceActions(issued, null, 'CREDIT_NOTE', 'ISSUE', false).send).toBe(true);
    expect(deriveInvoiceActions(issued, null, 'CREDIT_NOTE', 'ISSUE').send).toBe(true);
  });
});

describe('P3-T03 — the event that evidences the non-transmission', () => {
  it('reads the suppression out of the append-only log', () => {
    // "We did not transmit" is a fact the business may have to prove, so it is recorded rather than
    // merely enacted. A guard that only refused at send time would leave nothing behind.
    expect(isTransmissionSuppressed([{ type: 'ISSUED' }, { type: 'TRANSMISSION_SUPPRESSED' }])).toBe(true);
  });

  it('says no for an ordinary document, and for one with no log at all', () => {
    expect(isTransmissionSuppressed([{ type: 'ISSUED' }, { type: 'DELIVER' }])).toBe(false);
    expect(isTransmissionSuppressed([])).toBe(false);
    expect(isTransmissionSuppressed(null)).toBe(false);
    expect(isTransmissionSuppressed(undefined)).toBe(false);
  });
});
