/**
 * FatturaPA builder — CodiceDestinatario / PECDestinatario routing (F-16/M-8).
 *
 * Covers the 4-branch routing logic added to buildFatturaPa():
 *   1. valid 7-char IT_SDI code on the client → CodiceDestinatario = that code, no PEC
 *   2. no code but a PEC on file → CodiceDestinatario = '0000000' + PECDestinatario = the PEC
 *   3. foreign (non-IT) buyer, neither code nor PEC → 'XXXXXXX'
 *   4. domestic IT, neither code nor PEC → 'XXXXXXX' too (NOT '0000000' — that would fail the
 *      @digitalia/fatturapa FPAYupSchema business-rule gate without a PEC, see fattura-pa.ts JSDoc)
 *
 * Also runs the SAME two-stage gate FatturaPaFormatProvider.validate() runs (XSD then the yup
 * FPAYupSchema business-rule check) against the branches that changed shape, since that's the
 * real gate wired into ComplianceExecutor/compliance-service.send() — an XSD pass alone isn't
 * proof the invoice can actually be sent.
 */
import { validateXsd } from '@/compliance/schemas/validate';
import { buildFatturaPa } from './fattura-pa';
import { InvoiceRenderData } from '../render-data';

/** The exact business-rule gate FatturaPaFormatProvider.validate() runs (providers/format/providers.ts). */
async function fpaBusinessRuleValidate(xml: string): Promise<void> {
  const { fpa2js, fpaValidate, FPAYupSchema } = await import('@digitalia/fatturapa');
  const parsed = fpa2js(xml, { validate: true, valuesOnly: true });
  await fpaValidate(parsed, FPAYupSchema);
}

function baseData(client: Partial<InvoiceRenderData['client']> = {}): InvoiceRenderData {
  return {
    rawNumber: 'FT-2026-0001',
    number: null,
    issuedAt: new Date('2026-06-01T00:00:00.000Z'),
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    company: {
      name: 'Rossi SRL',
      description: null,
      foundedAt: null,
      currency: 'EUR',
      address: 'Via Roma 10',
      city: 'Milano',
      postalCode: '20100',
      country: 'Italy',
      partyIdentifiers: [
        { scheme: 'VAT', value: 'IT12345678901' },
        { scheme: 'LEGAL_ID', value: 'MI1234567' },
      ],
    },
    client: {
      type: 'COMPANY',
      name: 'Bianchi SpA',
      description: null,
      foundedAt: null,
      contactFirstname: null,
      contactLastname: null,
      salutation: null,
      sex: null,
      title: null,
      isActive: true,
      address: 'Corso Italia 20',
      city: 'Roma',
      postalCode: '00100',
      country: 'Italy',
      partyIdentifiers: [{ scheme: 'VAT', value: 'IT98765432109' }],
      ...client,
    },
    items: [{ name: 'Consulenza', quantity: 1, unitPrice: 100, vatRate: 22, type: 'SERVICE' }],
  };
}

function extractTag(xml: string, tag: string): string | undefined {
  const m = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return m?.[1];
}

describe('buildFatturaPa — CodiceDestinatario / PECDestinatario routing', () => {
  it('1. valid 7-char IT_SDI code wins → CodiceDestinatario = that code, no PECDestinatario', async () => {
    const data = baseData({
      partyIdentifiers: [
        { scheme: 'VAT', value: 'IT98765432109' },
        { scheme: 'IT_SDI', value: 'abc123x' }, // lowercase on purpose — must be uppercased
      ],
    });
    const xml = await buildFatturaPa(data);
    expect(extractTag(xml, 'CodiceDestinatario')).toBe('ABC123X');
    expect(xml).not.toContain('PECDestinatario');
  });

  it('1b. IT_SDI present but malformed (not 7 alphanumeric chars) is ignored, falls through', async () => {
    const data = baseData({
      partyIdentifiers: [
        { scheme: 'VAT', value: 'IT98765432109' },
        { scheme: 'IT_SDI', value: 'BAD-CODE' }, // 8 chars, contains a hyphen — invalid
      ],
    });
    const xml = await buildFatturaPa(data);
    // Domestic IT, no valid code, no PEC → falls to branch 4.
    expect(extractTag(xml, 'CodiceDestinatario')).toBe('XXXXXXX');
    expect(xml).not.toContain('PECDestinatario');
  });

  it('2. no IT_SDI but a PEC on file → CodiceDestinatario = 0000000 + PECDestinatario emitted', async () => {
    const data = baseData({
      partyIdentifiers: [
        { scheme: 'VAT', value: 'IT98765432109' },
        { scheme: 'PEC', value: 'bianchi@pec.it' },
      ],
    });
    const xml = await buildFatturaPa(data);
    expect(extractTag(xml, 'CodiceDestinatario')).toBe('0000000');
    expect(extractTag(xml, 'PECDestinatario')).toBe('bianchi@pec.it');

    // Structural placement: PECDestinatario must be a sibling of CodiceDestinatario inside
    // DatiTrasmissione, immediately after it (Schema_VFPR12.xsd sequence order).
    const datiTrasmissioneBlock = xml.match(/<DatiTrasmissione>[\s\S]*?<\/DatiTrasmissione>/)![0];
    expect(datiTrasmissioneBlock.indexOf('CodiceDestinatario')).toBeLessThan(
      datiTrasmissioneBlock.indexOf('PECDestinatario'),
    );

    // The whole document must still be Schema_VFPR12.xsd-valid with PECDestinatario present.
    const result = await validateXsd(xml, 'it/Schema_VFPR12.xsd');
    expect(result.valid).toBe(true);
    if (!result.valid) console.error('FatturaPA XSD errors (PEC branch):', result.errors);

    // Must also pass the real business-rule gate — this is the branch the FPAYupSchema
    // '0000000' → PECDestinatario-required rule is specifically there to satisfy.
    await expect(fpaBusinessRuleValidate(xml)).resolves.toBeUndefined();
  });

  it('3. foreign (non-IT) buyer, neither code nor PEC → XXXXXXX', async () => {
    const data = baseData({
      country: 'France',
      partyIdentifiers: [{ scheme: 'VAT', value: 'FR98765432109' }],
    });
    const xml = await buildFatturaPa(data);
    expect(extractTag(xml, 'CodiceDestinatario')).toBe('XXXXXXX');
    expect(xml).not.toContain('PECDestinatario');
  });

  it('4. domestic IT, neither code nor PEC → XXXXXXX, no PECDestinatario (0000000 would fail yup validation without a PEC)', async () => {
    const data = baseData({ partyIdentifiers: [{ scheme: 'VAT', value: 'IT98765432109' }] });
    const xml = await buildFatturaPa(data);
    expect(extractTag(xml, 'CodiceDestinatario')).toBe('XXXXXXX');
    expect(xml).not.toContain('PECDestinatario');

    const result = await validateXsd(xml, 'it/Schema_VFPR12.xsd');
    expect(result.valid).toBe(true);

    // Proves the fix: 'XXXXXXX' (not '0000000') is what keeps this branch passing the real
    // business-rule gate when there's no PEC on file.
    await expect(fpaBusinessRuleValidate(xml)).resolves.toBeUndefined();
  });

  it('IT_SDI code takes priority over a PEC when both are present', async () => {
    const data = baseData({
      partyIdentifiers: [
        { scheme: 'VAT', value: 'IT98765432109' },
        { scheme: 'IT_SDI', value: 'XYZ9876' },
        { scheme: 'PEC', value: 'bianchi@pec.it' },
      ],
    });
    const xml = await buildFatturaPa(data);
    expect(extractTag(xml, 'CodiceDestinatario')).toBe('XYZ9876');
    expect(xml).not.toContain('PECDestinatario');
  });
});
