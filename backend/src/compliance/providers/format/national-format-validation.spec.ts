/**
 * National Format Validation Harness — FatturaPA, CFDI, Facturae, KSA UBL, FA_VAT.
 *
 * Validates structural correctness of the XML output for each national format.
 * No authoritative validation (that requires external tools / XSD / services).
 * Gate vivant: presence of required root elements and data integrity.
 */
import { InvoiceRenderingService } from '@/modules/invoice-rendering/invoice-rendering.service';
import {
  IT_B2B,
  MX_B2B,
  ES_B2B,
  SA_B2B,
  PL_B2B,
  FormatFixture,
} from './__fixtures__/invoices';

interface NationalResult {
  fixture: string;
  format: string;
  xmlLength: number;
  hasRequiredElements: boolean;
  verdict: 'PASS' | 'FAIL' | 'PARTIAL';
  errors: string[];
}

describe('National Format — structural validation', () => {
  const service = new InvoiceRenderingService();
  const results: NationalResult[] = [];

  afterAll(() => {
    console.log('\n');
    console.table(
      results.map((r) => ({
        Fixture: r.fixture,
        Format: r.format,
        XMLSize: r.xmlLength,
        Valid: r.hasRequiredElements,
        Verdict: r.verdict,
        Errors: r.errors.length > 0 ? r.errors.join('; ') : '-',
      })),
    );
  });

  describe('FatturaPA 1.2 (IT)', () => {
    const fixture = IT_B2B;
    it(`${fixture.slug} → fatturapa`, async () => {
      const xml = await service.buildFatturaPa(fixture.data);
      expect(typeof xml).toBe('string');
      expect(xml.length).toBeGreaterThan(100);

      const errors: string[] = [];
      // Structural checks
      if (!xml.includes('FatturaElettronica')) errors.push('missing FatturaElettronica root');
      if (!xml.includes('FatturaElettronicaHeader')) errors.push('missing Header');
      if (!xml.includes('DatiTrasmissione')) errors.push('missing DatiTrasmissione');
      if (!xml.includes('CedentePrestatore')) errors.push('missing CedentePrestatore');
      if (!xml.includes('CessionarioCommittente')) errors.push('missing CessionarioCommittente');
      if (!xml.includes('FatturaElettronicaBody')) errors.push('missing Body');
      if (!xml.includes('DatiGeneraliDocumento')) errors.push('missing DatiGeneraliDocumento');
      if (!xml.includes('DettaglioLinee')) errors.push('missing DettaglioLinee');
      if (!xml.includes('DatiRiepilogo')) errors.push('missing DatiRiepilogo');
      if (!xml.includes('DatiPagamento')) errors.push('missing DatiPagamento');
      if (!xml.includes('TD01')) errors.push('missing TipoDocumento TD01');
      if (!xml.includes('Rossi SRL')) errors.push('missing seller name');

      results.push({
        fixture: fixture.slug,
        format: 'fatturapa',
        xmlLength: xml.length,
        hasRequiredElements: errors.length === 0,
        verdict: errors.length === 0 ? 'PASS' : 'FAIL',
        errors,
      });

      expect(errors).toEqual([]);
    });
  });

  describe('CFDI 4.0 (MX)', () => {
    const fixture = MX_B2B;
    it(`${fixture.slug} → cfdi`, async () => {
      const xml = await service.buildCfdi(fixture.data);
      expect(typeof xml).toBe('string');
      expect(xml.length).toBeGreaterThan(100);

      const errors: string[] = [];
      if (!xml.includes('Comprobante')) errors.push('missing Comprobante root');
      if (!xml.includes('Emisor')) errors.push('missing Emisor');
      if (!xml.includes('Receptor')) errors.push('missing Receptor');
      if (!xml.includes('Conceptos')) errors.push('missing Conceptos');
      if (!xml.includes('Impuestos')) errors.push('missing Impuestos');
      if (!xml.includes('Version="4.0"')) errors.push('missing Version 4.0');
      if (!xml.includes('TST101010100')) errors.push('missing seller RFC');
      if (!xml.includes('LOP8501011A9')) errors.push('missing buyer RFC');

      results.push({
        fixture: fixture.slug,
        format: 'cfdi',
        xmlLength: xml.length,
        hasRequiredElements: errors.length === 0,
        verdict: errors.length === 0 ? 'PASS' : 'FAIL',
        errors,
      });

      expect(errors).toEqual([]);
    });
  });

  describe('Facturae 3.2.2 (ES)', () => {
    const fixture = ES_B2B;
    it(`${fixture.slug} → facturae`, async () => {
      const xml = await service.buildFacturae(fixture.data);
      expect(typeof xml).toBe('string');
      expect(xml.length).toBeGreaterThan(100);

      const errors: string[] = [];
      if (!xml.includes('Facturae')) errors.push('missing Facturae root');
      if (!xml.includes('FileHeader')) errors.push('missing FileHeader');
      if (!xml.includes('Parties')) errors.push('missing Parties');
      if (!xml.includes('SellerParty')) errors.push('missing SellerParty');
      if (!xml.includes('BuyerParty')) errors.push('missing BuyerParty');
      if (!xml.includes('Invoices')) errors.push('missing Invoices');
      if (!xml.includes('InvoiceHeader')) errors.push('missing InvoiceHeader');
      if (!xml.includes('InvoiceTotals')) errors.push('missing InvoiceTotals');
      if (!xml.includes('InvoiceItems')) errors.push('missing InvoiceItems');
      if (!xml.includes('ES12345678A')) errors.push('missing seller VAT');

      results.push({
        fixture: fixture.slug,
        format: 'facturae',
        xmlLength: xml.length,
        hasRequiredElements: errors.length === 0,
        verdict: errors.length === 0 ? 'PASS' : 'FAIL',
        errors,
      });

      expect(errors).toEqual([]);
    });
  });

  describe('KSA UBL 2.1 (SA)', () => {
    const fixture = SA_B2B;
    it(`${fixture.slug} → ksa-ubl`, async () => {
      const xml = await service.buildKsaUbl(fixture.data);
      expect(typeof xml).toBe('string');
      expect(xml.length).toBeGreaterThan(100);

      const errors: string[] = [];
      if (!xml.includes('ubl:Invoice')) errors.push('missing ubl:Invoice root');
      if (!xml.includes('cbc:ID')) errors.push('missing cbc:ID');
      if (!xml.includes('cbc:IssueDate')) errors.push('missing cbc:IssueDate');
      if (!xml.includes('cac:AccountingSupplierParty')) errors.push('missing supplier');
      if (!xml.includes('cac:AccountingCustomerParty')) errors.push('missing customer');
      if (!xml.includes('cac:TaxTotal')) errors.push('missing TaxTotal');
      if (!xml.includes('cac:LegalMonetaryTotal')) errors.push('missing MonetaryTotal');
      if (!xml.includes('cac:InvoiceLine')) errors.push('missing InvoiceLine');
      if (!xml.includes('310123456700003')) errors.push('missing seller VAT');
      if (!xml.includes('TODO: ZATCA QR')) errors.push('missing QR placeholder');

      results.push({
        fixture: fixture.slug,
        format: 'ksa-ubl',
        xmlLength: xml.length,
        hasRequiredElements: errors.length === 0,
        verdict: errors.length === 0 ? 'PASS' : 'FAIL',
        errors,
      });

      expect(errors).toEqual([]);
    });
  });

  describe('FA_VAT (PL)', () => {
    const fixture = PL_B2B;
    it(`${fixture.slug} → fa-vat`, async () => {
      const xml = await service.buildFaVat(fixture.data);
      expect(typeof xml).toBe('string');
      expect(xml.length).toBeGreaterThan(100);

      const errors: string[] = [];
      if (!xml.includes('Fa')) errors.push('missing Fa root');
      if (!xml.includes('WersjaSchematu')) errors.push('missing WersjaSchematu');
      if (!xml.includes('FaWiersz')) errors.push('missing FaWiersz');
      if (!xml.includes('Podsumowanie')) errors.push('missing Podsumowanie');
      if (!xml.includes('PL1234567890')) errors.push('missing seller NIP');
      if (!xml.includes('FA(2)')) errors.push('missing schema version FA(2)');

      results.push({
        fixture: fixture.slug,
        format: 'fa-vat',
        xmlLength: xml.length,
        hasRequiredElements: errors.length === 0,
        verdict: errors.length === 0 ? 'PASS' : 'FAIL',
        errors,
      });

      expect(errors).toEqual([]);
    });
  });
});
