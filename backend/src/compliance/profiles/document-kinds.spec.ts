/**
 * The document kinds a country offers — and, above all, what the engine refuses to claim.
 */
import { documentKindsFor } from './document-kinds';
import { defaultRegistry } from './registry';

const at = new Date('2026-10-01');
const kindsFor = (cc: string) => documentKindsFor(defaultRegistry.resolve(cc).profile, at);
const codes = (cc: string) => kindsFor(cc).map((k) => k.kind);

describe('documentKindsFor', () => {
  it('a country offers every correcting document its routes leave open — France offers two', () => {
    // REWRITTEN BY P3-T02. This test used to assert that France offered a credit note and NOT a
    // corrective invoice, which was never a finding about France: it was an artefact of deriving the
    // menu from a single `correctionModel` value. CGI art. 289, I, 5 is explicit — "tout document ou
    // message qui modifie la facture initiale et qui y fait référence de façon spécifique et non
    // équivoque est assimilé à une facture" — so a French user may issue either, and the BOFiP
    // presents them as alternatives ("soit […] soit"). The menu now follows the routes.
    expect(codes('FR')).toContain('CREDIT_NOTE');
    expect(codes('FR')).toContain('CORRECTIVE_INVOICE');

    // Poland is the contrast, and it is a real one: the credit note is forbidden AS A DISTINCT
    // DOCUMENT (one instrument for both directions, and FA(3)'s RodzajFaktury has no type for it).
    expect(codes('PL')).toContain('CORRECTIVE_INVOICE');
    expect(codes('PL')).not.toContain('CREDIT_NOTE');

    // Spain shares Poland's structure and therefore its menu, despite a completely different statute.
    expect(codes('ES')).toContain('CORRECTIVE_INVOICE');
    expect(codes('ES')).not.toContain('CREDIT_NOTE');
  });

  it('Italy offers the debit note it is obliged to issue', () => {
    // Art. 26 DPR 633/72 comma 1 COMPELS a document on any increase, while comma 2 leaves the
    // decrease a faculty. The product never offered a debit note to anyone before P3-T02, so an
    // Italian user had no way to discharge the one correction their law actually requires.
    expect(codes('IT')).toContain('DEBIT_NOTE');
    expect(codes('IT')).toContain('CREDIT_NOTE');
    // …and no corrective invoice, which does not exist in Italian law at all.
    expect(codes('IT')).not.toContain('CORRECTIVE_INVOICE');
  });

  it('every country offers the invoice family', () => {
    for (const cc of ['FR', 'DE', 'IT', 'PL', 'ES', 'US', 'MX']) {
      expect(codes(cc)).toEqual(expect.arrayContaining(['INVOICE', 'DEPOSIT', 'FINAL']));
    }
  });

  it('a pro forma is never a legal document, and is never claimed to be permitted', () => {
    // The two halves of the model. `legalDocument: false` is a PRODUCT fact and it is enforced
    // elsewhere — `invoices.helpers.ts` refuses to issue a proforma, so it never takes a number
    // from the gapless series. `availability: UNVERIFIED` is the COUNTRY fact, and nobody has
    // sourced it for a single jurisdiction; saying AVAILABLE would be inventing an endorsement.
    for (const cc of ['FR', 'DE', 'IT', 'PL', 'MX', 'US']) {
      const proforma = kindsFor(cc).find((k) => k.kind === 'PROFORMA');
      expect(proforma).toBeDefined();
      expect(proforma?.legalDocument).toBe(false);
      expect(proforma?.availability).toBe('UNVERIFIED');
      expect(proforma?.openQuestion).toBeTruthy();
    }
  });

  it('everything in the invoice family IS a legal document', () => {
    for (const k of kindsFor('FR')) {
      expect(k.legalDocument).toBe(k.kind !== 'PROFORMA');
    }
  });

  it('the correction kind follows the country, at the DATE it is asked for', () => {
    // Poland moved to `faktura korygująca` with KSeF. Asking before and after must not give the
    // same answer, which is the whole reason this takes a date.
    const early = documentKindsFor(defaultRegistry.resolve('PL').profile, new Date('2020-01-01'));
    const late = documentKindsFor(defaultRegistry.resolve('PL').profile, new Date('2026-10-01'));
    expect(early.map((k) => k.kind)).not.toEqual(late.map((k) => k.kind));
  });

  it('a cancel-and-replace country may still offer other correcting documents — Mexico does', () => {
    // REWRITTEN BY P3-T02, and this one was worse than merely narrow: it asserted a falsehood, and
    // passed only because no shipped profile had ever declared CANCEL_AND_REPLACE, so its body never
    // ran. The moment Mexico declared it — the country that actually requires the route — the test
    // would have locked in "Mexico has no credit note", which the SAT contradicts in so many words:
    // "Este comprobante es conocido como nota de crédito" (Anexo 20, Apéndice 2).
    //
    // Mexico needs BOTH, and the dividing line is sharp: the CFDI tipo E for wrong AMOUNTS, and
    // cancel-and-replace when the DOCUMENT itself is wrong. The cancellation is also bounded to the
    // fiscal year while the tipo E is not, so once the year closes the credit note is all that is
    // left. A menu that hid it would strand the user.
    const mx = defaultRegistry.resolve('MX').profile;
    expect(mx.lifecycle.some((t) => t.value.correctionModel === 'CANCEL_AND_REPLACE')).toBe(true);

    expect(codes('MX')).toContain('CREDIT_NOTE');
    // Cancel-and-replace still produces no document of its OWN — the replacement is a fresh INVOICE,
    // which is already in the list — and Mexico has no amend-by-reference instrument.
    expect(codes('MX')).toContain('INVOICE');
    expect(codes('MX')).not.toContain('CORRECTIVE_INVOICE');
  });
});
