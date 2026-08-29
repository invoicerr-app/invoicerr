/**
 * BT-25 / BT-26 — the invoice a correction corrects.
 *
 * A credit note that does not say WHICH invoice it reverses is not a credit note, it is a negative
 * invoice. France rejects it outright, and superpdp says so precisely:
 *
 *   "BR-FR-CO-05/BT-3 : Si le type de facture (BT-3) est un avoir (261, 381, 396, 502, 503), alors
 *    au moins une référence à une facture antérieure (BT-25) avec sa date (BT-26) doit être présente
 *    au niveau entête. Références entête trouvées : 0."   — dépôt 375060, 2026-08-29
 *
 * With the reference added, the same document is accepted: fr:200 → fr:201 → fr:202, dépôt 375061.
 */
import { InvoiceRenderingService } from './invoice-rendering.service';
import { normalizeCiiNamespaces } from '@/compliance/schemas/cii-post-process';

const data = (extra: Record<string, unknown>) =>
  ({
    kind: 'CREDIT_NOTE',
    rawNumber: 'AV-1',
    number: 1,
    issuedAt: new Date('2026-08-29'),
    createdAt: new Date('2026-08-29'),
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
    ...extra,
  }) as never;

describe('BT-25 / BT-26', () => {
  it('a correction carries the number and date of what it corrects', async () => {
    const built = new InvoiceRenderingService().buildEInvoice(
      data({ precedingInvoice: { number: 'INV-2026-0001', issueDate: '2026-08-20' } }),
    );
    // The two syntaxes date it differently, and the test says so rather than looking for one form
    // in both: UBL writes ISO, CII writes UNTDID 2379 format 102 (YYYYMMDD) inside a
    // `qdt:DateTimeString` — which is precisely the element whose prefix was left undeclared.
    for (const [fmt, date] of [
      ['ubl', '2026-08-20'],
      ['cii', '20260820'],
    ] as const) {
      const xml = await built.exportXml(fmt);
      expect(`${fmt}: number`).toBe(xml.includes('INV-2026-0001') ? `${fmt}: number` : `${fmt}: MISSING`);
      expect(`${fmt}: date`).toBe(xml.includes(date) ? `${fmt}: date` : `${fmt}: MISSING`);
    }
  }, 60000);

  it('a document with nothing to reference emits no reference at all', async () => {
    // Not an empty BillingReference — none. An empty one would be a claim that there IS a preceding
    // document, which is worse than silence.
    const xml = await new InvoiceRenderingService().buildEInvoice(data({ kind: 'INVOICE' })).exportXml('ubl');
    expect(xml).not.toContain('BillingReference');
  }, 60000);
});

describe('normalizeCiiNamespaces — the qdt prefix', () => {
  it('rewrites qdt: elements instead of leaving them undeclared', () => {
    // The declaration was stripped and the elements were not rewritten, so every qdt: element left
    // with an UNDECLARED prefix. Invisible until a document used one — BT-26 is the first.
    const before =
      '<rsm:CrossIndustryInvoice xmlns:rsm="a" xmlns:ram="b" xmlns:udt="c" xmlns:qdt="d">' +
      '<ram:X><qdt:DateTimeString>2026-08-20</qdt:DateTimeString></ram:X>' +
      '</rsm:CrossIndustryInvoice>';
    const after = normalizeCiiNamespaces(before);

    expect(after).not.toContain('qdt:');
    expect(after).toContain(
      '<DateTimeString xmlns="urn:un:unece:uncefact:data:standard:QualifiedDataType:100">',
    );
  });

  it('still leaves an already-normalized document alone', () => {
    const plain = '<CrossIndustryInvoice xmlns="x"><A>1</A></CrossIndustryInvoice>';
    expect(normalizeCiiNamespaces(plain)).toBe(plain);
  });
});
