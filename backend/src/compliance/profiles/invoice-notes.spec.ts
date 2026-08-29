/**
 * BG-1 — the mentions a country requires, and the fact that they reach the transmitted document.
 *
 * France is the only profile that carries any, and that is the point: the engine renders what the
 * profile lists and names no jurisdiction. Germany asserting ZERO notes is as load-bearing as France
 * asserting three — it proves nothing was hard-coded into the renderer.
 */
import { resolveInvoiceNotes, toUblNote } from './invoice-notes';
import { defaultRegistry } from './registry';
import { InvoiceRenderingService } from '@/modules/invoice-rendering/invoice-rendering.service';

const fr = () => defaultRegistry.resolve('FR').profile;

describe('resolveInvoiceNotes', () => {
  it('France carries the three mentions of C. com. L441-9 I al. 5', () => {
    const notes = resolveInvoiceNotes(fr(), new Date('2026-09-02'));
    expect(notes.map((n) => n.subjectCode)).toEqual(['PMT', 'PMD', 'AAB']);
    // The recovery indemnity is a fixed legal amount (D441-5), not a commercial choice.
    expect(notes[0].text).toContain('40 €');
    expect(notes[2].text).toBe('Escompte pour paiement anticipé : néant');
  });

  it('the late-payment rate is the one in force at the ISSUE date, not today', () => {
    // ECB refi + 10 points, read at 1 January and 1 July (L441-10 II). An invoice issued in the
    // first half-year keeps that half-year's rate for ever — recomputing it later would restate a
    // document that was correct when issued.
    expect(resolveInvoiceNotes(fr(), new Date('2026-03-01'))[1].text).toContain('12,15 %');
    expect(resolveInvoiceNotes(fr(), new Date('2026-09-02'))[1].text).toContain('12,40 %');
  });

  it('a country that requires nothing gets nothing — no jurisdiction is named in code', () => {
    for (const cc of ['DE', 'IT', 'PL', 'ES', 'US', 'MX', 'JP']) {
      expect(
        `${cc}: ${resolveInvoiceNotes(defaultRegistry.resolve(cc).profile, new Date('2026-09-02')).length}`,
      ).toBe(`${cc}: 0`);
    }
  });

  it('encodes BT-21 the way BR-CL-08 validates it', () => {
    // "#XXX#text" — the UBL Schematron tests the three characters between two hashes against
    // UNCL4451. All three codes France uses are in that list.
    expect(toUblNote({ subjectCode: 'PMT', text: 'x', legalRef: '' })).toBe('#PMT#x');
    expect(toUblNote({ text: 'x', legalRef: '' })).toBe('x');
  });
});

describe('the mentions reach the document', () => {
  it('a French invoice carries all three notes in UBL and in CII', async () => {
    // The half that matters. A resolver nobody calls would be the repo's signature defect; this
    // renders through the real generator and looks for the text in the output.
    const notes = resolveInvoiceNotes(fr(), new Date('2026-09-02')).map((n) => ({
      subjectCode: n.subjectCode,
      text: n.text,
    }));
    const built = new InvoiceRenderingService().buildEInvoice({
      kind: 'INVOICE',
      notes,
      rawNumber: 'X-1',
      number: 1,
      issuedAt: new Date('2026-09-02'),
      createdAt: new Date('2026-09-02'),
      paymentMethod: 'BANK_TRANSFER',
      paymentDetails: 'FR7630006000011234567890189',
      company: {
        name: 'Seller',
        description: null,
        foundedAt: null,
        currency: 'EUR',
        address: '1 rue A',
        city: 'Millau',
        postalCode: '12100',
        country: 'France',
        email: 's@example.test',
        partyIdentifiers: [{ scheme: 'VAT', value: 'FR18000000002' }],
      },
      client: {
        type: 'COMPANY',
        name: 'Buyer',
        description: null,
        foundedAt: null,
        contactFirstname: null,
        contactLastname: null,
        salutation: null,
        sex: null,
        title: null,
        isActive: true,
        address: '2 rue B',
        city: 'Tours',
        postalCode: '37170',
        country: 'France',
        partyIdentifiers: [{ scheme: 'VAT', value: 'FR15000000001' }],
      },
      items: [
        { name: 'Prestation', quantity: 1, unitPrice: 100, vatRate: 20, vatCategory: 'S', type: 'SERVICE' },
      ],
    } as never);

    for (const fmt of ['ubl', 'cii']) {
      const xml = await built.exportXml(fmt);
      expect(`${fmt}: 40 €`).toBe(xml.includes('40 €') ? `${fmt}: 40 €` : `${fmt}: MISSING`);
      expect(`${fmt}: rate`).toBe(xml.includes('12,40 %') ? `${fmt}: rate` : `${fmt}: MISSING`);
      expect(`${fmt}: escompte`).toBe(xml.includes('Escompte') ? `${fmt}: escompte` : `${fmt}: MISSING`);
    }
  }, 60000);
});
