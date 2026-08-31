/**
 * fa3-provider.ts — root TODO item 10, wave 2. Proves the REAL vendored `schemat_FA3.xsd` actually
 * judges what this provider emits (never a home-made replacement — see `vendored/validate-xsd.ts`'s
 * own header), that an amount TRACES from the document's own data through `compute-totals.ts` to a
 * specific XML field (never recomputed by this provider), and that the gate is not decorative: strip
 * one mandatory element from an otherwise-valid document and the SAME schema says so.
 */
import { buildInvoiceDescriptor } from '../../descriptors/invoice.descriptor';
import { DocumentTypeDescriptor } from '../../descriptors/types';
import { DocumentFormatParty } from '../format-provider';
import { validateXsd } from '../vendored/validate-xsd';
import { fa3FormatProvider } from './fa3-provider';

const descriptor: DocumentTypeDescriptor = buildInvoiceDescriptor();

const SELLER: DocumentFormatParty = {
  name: 'Kowalski Consulting Sp. z o.o.',
  address: 'ul. Testowa 1',
  city: 'Warszawa',
  postalCode: '00-001',
  country: 'Poland',
  email: 'kontakt@kowalski.example',
  // A structurally valid NIP (schemat_FA3's own `[1-9]((\d[1-9])|([1-9]\d))\d{7}` pattern — 10
  // digits, cannot start with 0, cannot have "00" in positions 2-3) — this is the well-known
  // Ministry-of-Finance TEST NIP, not a real taxpayer.
  partyIdentifiers: [{ scheme: 'VAT', value: 'PL5260001246' }],
};

const BUYER: DocumentFormatParty = {
  name: 'Nowak Sp. z o.o.',
  address: 'ul. Kupiecka 2',
  city: 'Kraków',
  postalCode: '31-010',
  country: 'Poland',
  partyIdentifiers: [{ scheme: 'VAT', value: 'PL9876543210' }],
};

/**
 * Fixture "chiffrée à la main" — les montants ci-dessous sont calculés AVANT le build, pour que le
 * test trace un montant précis jusqu'au champ XML qui le porte, plutôt que de se contenter d'un
 * "ça construit sans erreur".
 *
 *  - Ligne 1 : 2 × 500,00 PLN @ 23% TVA, sans remise → net 1000,00 ; TVA 230,00 ; TTC 1230,00.
 *  - Ligne 2 : 1 × 200,00 PLN @ 8% TVA, remise 10% → net APRÈS remise 180,00 (200 × 0,90) ; TVA
 *    14,40 (8% de 180) ; TTC 194,40.
 *  - Total document : net 1180,00 ; TVA 244,40 ; TTC 1424,40.
 */
const VALID_DATA = {
  client: 'client-1',
  issueDate: '2026-09-15',
  dueDate: '2026-10-15',
  currency: 'PLN',
  lines: [
    { description: 'Usługa doradcza', quantity: 2, unit: 'godz.', unitPrice: 500, vatRate: '23' },
    {
      description: 'Wsparcie techniczne',
      quantity: 1,
      unit: 'szt.',
      unitPrice: 200,
      vatRate: '8',
      discountPercent: 10,
    },
  ],
};

function extractTag(xml: string, tag: string): string | undefined {
  const m = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return m?.[1];
}

function document(data: unknown, displayNumber = 'FA-2026-0001') {
  return { id: 'doc-1', data, displayNumber, status: 'sending', createdAt: new Date('2026-09-15T10:00:00Z') };
}

describe('fa3-provider — FA(3) gated by the REAL vendored schemat_FA3.xsd', () => {
  it('declares itself correctly for the format registry / download-xml param', () => {
    expect(fa3FormatProvider.id).toBe('fa3');
    expect(fa3FormatProvider.mime).toBe('application/xml');
  });

  it('a VALID document: passes the real XSD, and the computed amount reaches the right field', async () => {
    const result = await fa3FormatProvider.build(descriptor, document(VALID_DATA), SELLER, BUYER);

    expect(result.validation.valid).toBe(true);
    expect(result.validation.errors).toEqual([]);

    const xml = new TextDecoder().decode(result.bytes);

    // Line 1's net (1000.00, no discount) reaches P_11 verbatim from compute-totals.ts, never
    // recomputed here.
    expect(xml).toMatch(/<P_7>Usługa doradcza<\/P_7>/);
    expect(xml).toMatch(/<P_11>1000<\/P_11>/);
    // Line 2's net is the DISCOUNTED 180.00 (200 × 0.90), not the sticker 200 — proves the discount
    // is applied before this provider ever sees the number (compute-totals.ts's own job).
    expect(xml).toMatch(/<P_9A>200<\/P_9A>/); // raw unit price, unaffected by the discount
    expect(xml).toMatch(/<P_11>180<\/P_11>/); // discounted net
    // Per-rate summary buckets: 23% bucket is P_13_1/P_14_1, 8% bucket is P_13_2/P_14_2.
    expect(extractTag(xml, 'P_13_1')).toBe('1000.00');
    expect(extractTag(xml, 'P_14_1')).toBe('230.00');
    expect(extractTag(xml, 'P_13_2')).toBe('180.00');
    expect(extractTag(xml, 'P_14_2')).toBe('14.40');
    // Grand total (P_15) is the document's own gross, from totals.grossMinor (P_15 is a numeric
    // field, like P_11 — xmlbuilder2 renders the JS Number, so a whole-cents total loses its
    // trailing zero the same way "1000" does above; this is a formatting artifact of the field's
    // NUMERIC type, not a wrong amount).
    expect(extractTag(xml, 'P_15')).toBe('1424.4');
    // NIP stripped of its "PL" prefix, per the FA(3) TIdentyfikator shape.
    expect(extractTag(xml, 'NIP')).toBe('5260001246');
  });

  it('a seller with no VAT identifier: the REAL XSD refuses it (NIP pattern), never a silent pass', async () => {
    const sellerNoVat: DocumentFormatParty = { ...SELLER, partyIdentifiers: [] };
    const result = await fa3FormatProvider.build(descriptor, document(VALID_DATA), sellerNoVat, BUYER);

    expect(result.validation.valid).toBe(false);
    expect(result.validation.errors.length).toBeGreaterThan(0);
  });

  it('MUTATION-STYLE PROOF: stripping a mandatory field (P_1, issue date) from an otherwise-valid document makes the SAME schema reject it', async () => {
    const result = await fa3FormatProvider.build(descriptor, document(VALID_DATA), SELLER, BUYER);
    expect(result.validation.valid).toBe(true);
    const validXml = new TextDecoder().decode(result.bytes);

    const mutatedXml = validXml.replace(/<P_1>[^<]*<\/P_1>/, '');
    expect(mutatedXml).not.toBe(validXml);

    const directResult = await validateXsd(mutatedXml, 'pl/schemat_FA3.xsd');
    expect(directResult.valid).toBe(false);
    expect(directResult.errors.length).toBeGreaterThan(0);
    // The error cites the missing element by name — the gate is not decorative.
    expect(directResult.errors.join(' ')).toMatch(/P_1/);
  });
});
