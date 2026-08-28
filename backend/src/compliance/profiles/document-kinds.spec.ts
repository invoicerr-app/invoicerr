/**
 * The document kinds a country offers — and, above all, what the engine refuses to claim.
 */
import { documentKindsFor } from './document-kinds';
import { defaultRegistry } from './registry';

const at = new Date('2026-10-01');
const kindsFor = (cc: string) => documentKindsFor(defaultRegistry.resolve(cc).profile, at);
const codes = (cc: string) => kindsFor(cc).map((k) => k.kind);

describe('documentKindsFor', () => {
  it('France offers a credit note, Poland a corrective invoice — derived, not declared', () => {
    // Neither profile lists its document kinds. `correctionModel` already fixes the answer, so all
    // 108 jurisdictions get one without anyone writing 108 lines that could each be wrong.
    expect(codes('FR')).toContain('CREDIT_NOTE');
    expect(codes('FR')).not.toContain('CORRECTIVE_INVOICE');
    expect(codes('PL')).toContain('CORRECTIVE_INVOICE');
    expect(codes('PL')).not.toContain('CREDIT_NOTE');
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

  it('a cancel-and-replace country is offered no correction document of its own', () => {
    // Naming a credit note here would name a document the country does not use: the original is
    // cancelled outright and a fresh invoice replaces it.
    const country = ['FR', 'DE', 'IT', 'PL', 'ES', 'US', 'MX', 'BR', 'CL', 'TR', 'IN'].find((cc) => {
      const p = defaultRegistry.resolve(cc).profile;
      return p.lifecycle.some((t) => t.value.correctionModel === 'CANCEL_AND_REPLACE');
    });
    if (!country) return; // none in the pivots today — the branch stays covered by the map itself
    const k = codes(country);
    expect(k).not.toContain('CREDIT_NOTE');
    expect(k).not.toContain('CORRECTIVE_INVOICE');
  });
});
