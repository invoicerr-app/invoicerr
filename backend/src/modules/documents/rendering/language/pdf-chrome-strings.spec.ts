import { pdfChromeStrings } from './pdf-chrome-strings';

describe('pdfChromeStrings', () => {
  // Locks in the pre-existing English literals `rendering/render-html.ts` hardcoded before this
  // feature existed — a regression here would silently change the DEFAULT (unlanguaged) PDF output
  // every existing render-html.spec.ts assertion already depends on.
  it("'en' matches the exact literals render-html.ts used before this feature existed", () => {
    const en = pdfChromeStrings('en');
    expect(en.status).toBe('Status');
    expect(en.date).toBe('Date');
    expect(en.totals).toBe('Totals');
    expect(en.net).toBe('Net');
    expect(en.total).toBe('Total');
    expect(en.yes).toBe('Yes');
    expect(en.no).toBe('No');
    expect(en.draftNoNumberYet).toBe('Draft — no number yet');
    expect(en.scanToPaySepa).toBe('Scan to pay (SEPA)');
    expect(en.vatOn('20', '100.00 EUR')).toBe('VAT 20% on 100.00 EUR');
  });

  // The distinguishing pair this feature's own e2e/report leans on: Italian "IVA" vs French "TVA" for
  // the exact same statutory concept (VAT) — proof the chrome vocabulary genuinely varies by language,
  // never a coincidence of two identical strings.
  it('the VAT line reads distinctly per language', () => {
    expect(pdfChromeStrings('it').vatOn('20', '100.00 EUR')).toBe('IVA 20% su 100.00 EUR');
    expect(pdfChromeStrings('fr').vatOn('20', '100.00 EUR')).toBe('TVA 20% sur 100.00 EUR');
    expect(pdfChromeStrings('de').vatOn('20', '100.00 EUR')).toBe('USt. 20% auf 100.00 EUR');
    expect(pdfChromeStrings('pl').vatOn('20', '100.00 EUR')).toBe('VAT 20% od 100.00 EUR');
    expect(pdfChromeStrings('pt').vatOn('20', '100.00 EUR')).toBe('IVA 20% sobre 100.00 EUR');
  });

  it('every supported language has its own non-English Yes/No pair (except the two that legitimately overlap)', () => {
    expect(pdfChromeStrings('fr').yes).toBe('Oui');
    expect(pdfChromeStrings('fr').no).toBe('Non');
    expect(pdfChromeStrings('it').yes).toBe('Sì');
    expect(pdfChromeStrings('de').yes).toBe('Ja');
    expect(pdfChromeStrings('de').no).toBe('Nein');
    expect(pdfChromeStrings('pt').yes).toBe('Sim');
    expect(pdfChromeStrings('pt').no).toBe('Não');
  });
});
