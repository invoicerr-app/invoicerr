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

  // ── FPA12 (government recipient) — the two named gaps `3cb39f91` left open, closed by this task ──
  // See fatturapa-provider.ts's own header ("FPA12 vs FPR12") for the discriminant chosen (a valid
  // 6-char `IT_PA_CODE` party identifier, never `Client.kind`) and the XSD verification.
  it('PA: a valid 6-char IT_PA_CODE on the client wins outright → FPA12 (versione + FormatoTrasmissione), CodiceDestinatario = that code, judged by the SAME real XSD', async () => {
    const buyer: DocumentFormatParty = {
      ...BUYER,
      partyIdentifiers: [...BUYER.partyIdentifiers, { scheme: 'IT_PA_CODE', value: 'abc123' }],
    };
    const result = await fatturapaFormatProvider.build(descriptor, document(VALID_DATA), SELLER, buyer);
    const xml = new TextDecoder().decode(result.bytes);

    expect(xml).toMatch(/versione="FPA12"/);
    expect(extractTag(xml, 'FormatoTrasmissione')).toBe('FPA12');
    // Uppercased, same convention the existing IT_SDI test already proves for the B2B branch.
    expect(extractTag(xml, 'CodiceDestinatario')).toBe('ABC123');
    expect(xml).not.toContain('PECDestinatario');

    // The REAL vendored XSD — the SAME `Schema_VFPR12.xsd` used for every FPR12 case above (see this
    // provider's own header: it judges BOTH transmission formats, confirmed directly against the two
    // schemas fatturapa.gov.it itself publishes today for its 1.2.3 revision). Never asserted against
    // a B2B-only schema that would wrongly reject this.
    expect(result.validation.valid).toBe(true);
    expect(result.validation.errors).toEqual([]);
  });

  it('PA code wins outright even when a 7-char IT_SDI is ALSO on file — a client is never routed as both PA and B2B at once', async () => {
    const buyer: DocumentFormatParty = {
      ...BUYER,
      partyIdentifiers: [
        ...BUYER.partyIdentifiers,
        { scheme: 'IT_SDI', value: 'abc123x' },
        { scheme: 'IT_PA_CODE', value: 'UFE0A1' },
      ],
    };
    const result = await fatturapaFormatProvider.build(descriptor, document(VALID_DATA), SELLER, buyer);
    const xml = new TextDecoder().decode(result.bytes);
    expect(extractTag(xml, 'FormatoTrasmissione')).toBe('FPA12');
    expect(extractTag(xml, 'CodiceDestinatario')).toBe('UFE0A1');
    expect(result.validation.valid).toBe(true);
  });

  it('an IT_PA_CODE that is NOT exactly 6 characters never fires the PA branch — falls through to the ordinary B2B routing, FPR12 unchanged (regression: same fallback "4." already proves)', async () => {
    const buyer: DocumentFormatParty = {
      ...BUYER,
      partyIdentifiers: [...BUYER.partyIdentifiers, { scheme: 'IT_PA_CODE', value: 'TOOLONG7' }],
    };
    const result = await fatturapaFormatProvider.build(descriptor, document(VALID_DATA), SELLER, buyer);
    const xml = new TextDecoder().decode(result.bytes);
    expect(extractTag(xml, 'FormatoTrasmissione')).toBe('FPR12');
    expect(extractTag(xml, 'CodiceDestinatario')).toBe('XXXXXXX');
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

  // REGRESSION — root TODO item L1 ("R002 : le vendeur français passe enfin la validation Peppol
  // BIS"): `peppol-post-process.ts#mergePeppolNotesInObject` is wired ONLY into
  // `peppol-bis-provider.ts` (see that file's own header). This provider never calls
  // `build-semantic-invoice.ts`/`shared-build.ts` at all — it has no `cbc:Note`/mentions concept
  // whatsoever (`@digitalia/fatturapa`'s own FatturaPA XML has no equivalent field this codebase
  // fills) — so a French seller carrying the three C. com. mentions (`mentions/data/fr.json`) that
  // the Peppol fix exists for builds here EXACTLY as before: unaffected, because there was never
  // anything for the fix to touch on this path.
  it('a French seller (the same one Peppol BIS now merges notes for) still builds a valid FatturaPA document — untouched, this provider has no note mechanism at all', async () => {
    const frenchSeller: DocumentFormatParty = {
      name: 'Dupont Consulting SARL',
      address: '12 Rue de la Paix',
      city: 'Paris',
      postalCode: '75002',
      country: 'France',
      email: 'contact@dupont-consulting.example',
      partyIdentifiers: [
        { scheme: 'VAT', value: 'FR12345678901' },
        { scheme: 'LEGAL_ID', value: '12345678900017' },
      ],
    };
    const result = await fatturapaFormatProvider.build(descriptor, document(VALID_DATA), frenchSeller, BUYER);
    expect(result.validation.valid).toBe(true);
    expect(result.validation.errors).toEqual([]);

    // No note/mention artifact of any kind leaked in — this format simply does not carry BG-1.
    const xml = new TextDecoder().decode(result.bytes);
    expect(xml).not.toContain('PMT');
    expect(xml).not.toContain('frais de recouvrement');
  });
});
