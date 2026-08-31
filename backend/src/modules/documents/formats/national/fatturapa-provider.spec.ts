/**
 * fatturapa-provider.ts — root TODO item 10, wave 2. Same discipline as `fa3-provider.spec.ts`:
 * proves the REAL vendored `Schema_VFPR12.xsd` judges what this provider emits, that an amount
 * TRACES from the document's own data through `compute-totals.ts` to a specific XML field (never
 * recomputed here), and that the gate actually enforces something (a mandatory field removed makes
 * the SAME schema reject it) — plus the CodiceDestinatario/PECDestinatario routing REPRISED from
 * `fattura-pa.spec.ts` at the repère.
 */
import { buildInvoiceDescriptor } from '../../descriptors/invoice.descriptor';
import { DocumentTypeDescriptor } from '../../descriptors/types';
import { DocumentFormatParty } from '../format-provider';
import { validateXsd } from '../vendored/validate-xsd';
import { fatturapaFormatProvider } from './fatturapa-provider';

const descriptor: DocumentTypeDescriptor = buildInvoiceDescriptor();

const SELLER: DocumentFormatParty = {
  name: 'Rossi SRL',
  address: 'Via Roma 10',
  city: 'Milano',
  postalCode: '20100',
  country: 'Italy',
  partyIdentifiers: [
    { scheme: 'VAT', value: 'IT12345678901' },
    { scheme: 'LEGAL_ID', value: 'MI1234567' },
  ],
};

const BUYER: DocumentFormatParty = {
  name: 'Bianchi SpA',
  address: 'Corso Italia 20',
  city: 'Roma',
  postalCode: '00100',
  country: 'Italy',
  partyIdentifiers: [{ scheme: 'VAT', value: 'IT98765432109' }],
};

/**
 * Fixture "chiffrée à la main" :
 *  - Ligne 1 : 1 × 1000,00 € @ 22% TVA, sans remise → net 1000,00 ; TVA 220,00.
 *  - Ligne 2 : 2 × 50,00 € @ 10% TVA, remise 20% → net APRÈS remise 80,00 (100 × 0,80) ; TVA 8,00
 *    (10% de 80).
 *  - Total document : net 1080,00 ; TVA 228,00 ; TTC 1308,00.
 */
const VALID_DATA = {
  client: 'client-1',
  issueDate: '2026-09-15',
  dueDate: '2026-10-15',
  currency: 'EUR',
  lines: [
    { description: 'Consulenza strategica', quantity: 1, unit: 'unit', unitPrice: 1000, vatRate: '22' },
    {
      description: 'Assistenza tecnica',
      quantity: 2,
      unit: 'ora',
      unitPrice: 50,
      vatRate: '10',
      discountPercent: 20,
    },
  ],
};

function extractTag(xml: string, tag: string): string | undefined {
  const m = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return m?.[1];
}

function flatten(xml: string): string {
  return xml.replace(/>\s+</g, '><');
}

function document(data: unknown, displayNumber = 'FT-2026-0001') {
  return { id: 'doc-1', data, displayNumber, status: 'sending' };
}

describe('fatturapa-provider — FatturaPA gated by the REAL vendored Schema_VFPR12.xsd', () => {
  it('declares itself correctly for the format registry / download-xml param', () => {
    expect(fatturapaFormatProvider.id).toBe('fatturapa');
    expect(fatturapaFormatProvider.mime).toBe('application/xml');
  });

  it('a VALID document: passes the real XSD, and computed amounts (discount applied) reach the right fields', async () => {
    const result = await fatturapaFormatProvider.build(descriptor, document(VALID_DATA), SELLER, BUYER);

    expect(result.validation.valid).toBe(true);
    expect(result.validation.errors).toEqual([]);

    const xml = flatten(new TextDecoder().decode(result.bytes));

    expect(xml).toContain('<Descrizione>Consulenza strategica</Descrizione>');
    // DatiRiepilogo, grouped by rate — from totals.vatBreakdown, never recomputed.
    expect(xml).toContain(
      '<AliquotaIVA>22.00</AliquotaIVA><ImponibileImporto>1000.00</ImponibileImporto><Imposta>220.00</Imposta>',
    );
    // Line 2's discount (20%) is applied BEFORE this provider ever sees the number: sticker
    // 2×50.00=100.00, discounted net is 80.00, so the 10% bucket sees 80.00/8.00, never 100.00/10.00.
    expect(xml).toContain(
      '<AliquotaIVA>10.00</AliquotaIVA><ImponibileImporto>80.00</ImponibileImporto><Imposta>8.00</Imposta>',
    );
    expect(extractTag(xml, 'ImportoTotaleDocumento')).toBe('1308.00');
  });

  it('1. valid 7-char IT_SDI code wins → CodiceDestinatario = that code, no PECDestinatario', async () => {
    const buyer: DocumentFormatParty = {
      ...BUYER,
      partyIdentifiers: [...BUYER.partyIdentifiers, { scheme: 'IT_SDI', value: 'abc123x' }],
    };
    const result = await fatturapaFormatProvider.build(descriptor, document(VALID_DATA), SELLER, buyer);
    const xml = new TextDecoder().decode(result.bytes);
    expect(extractTag(xml, 'CodiceDestinatario')).toBe('ABC123X');
    expect(xml).not.toContain('PECDestinatario');
  });

  it('2. no IT_SDI but a PEC on file → CodiceDestinatario = 0000000 + PECDestinatario emitted, and the whole document is still XSD-valid', async () => {
    const buyer: DocumentFormatParty = {
      ...BUYER,
      partyIdentifiers: [
        { scheme: 'VAT', value: 'IT98765432109' },
        { scheme: 'PEC', value: 'bianchi@pec.it' },
      ],
    };
    const result = await fatturapaFormatProvider.build(descriptor, document(VALID_DATA), SELLER, buyer);
    const xml = new TextDecoder().decode(result.bytes);
    expect(extractTag(xml, 'CodiceDestinatario')).toBe('0000000');
    expect(extractTag(xml, 'PECDestinatario')).toBe('bianchi@pec.it');
    expect(result.validation.valid).toBe(true);
  });

  it('4. domestic IT, neither code nor PEC on file → XXXXXXX (never 0000000 without a PEC)', async () => {
    const buyer: DocumentFormatParty = {
      ...BUYER,
      partyIdentifiers: [{ scheme: 'VAT', value: 'IT98765432109' }],
    };
    const result = await fatturapaFormatProvider.build(descriptor, document(VALID_DATA), SELLER, buyer);
    const xml = new TextDecoder().decode(result.bytes);
    expect(extractTag(xml, 'CodiceDestinatario')).toBe('XXXXXXX');
    expect(xml).not.toContain('PECDestinatario');
    expect(result.validation.valid).toBe(true);
  });

  it('MUTATION-STYLE PROOF: stripping a mandatory field (Data, the document date) from an otherwise-valid document makes the SAME schema reject it', async () => {
    const result = await fatturapaFormatProvider.build(descriptor, document(VALID_DATA), SELLER, BUYER);
    expect(result.validation.valid).toBe(true);
    const validXml = new TextDecoder().decode(result.bytes);

    const mutatedXml = validXml.replace(/<Data>[^<]*<\/Data>/, '');
    expect(mutatedXml).not.toBe(validXml);

    const directResult = await validateXsd(mutatedXml, 'it/Schema_VFPR12.xsd');
    expect(directResult.valid).toBe(false);
    expect(directResult.errors.length).toBeGreaterThan(0);
    expect(directResult.errors.join(' ')).toMatch(/Data/);
  });
});
