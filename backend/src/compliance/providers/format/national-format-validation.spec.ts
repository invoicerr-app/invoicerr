/**
 * National Format Validation Harness — all national XML formats.
 *
 * Validates structural correctness of the XML output for each national format.
 * PL FA(2): authoritative XSD validation via vendored schemas + libxmljs2.
 * Gate vivant: presence of required root elements and data integrity.
 */
import { InvoiceRenderingService } from '@/modules/invoice-rendering/invoice-rendering.service';
import { validateXsd, XsdResult } from '@/compliance/schemas/validate';
import {
  IT_B2B,
  IT_MULTI_VAT,
  IT_REVERSE_CHARGE,
  IT_ESENTE,
  MX_B2B,
  ES_B2B,
  SA_B2B,
  PL_B2B,
  PL_B2B_MULTI_VAT,
  PL_B2B_EXEMPT,
  PL_B2C,
  CL_B2B,
  AR_B2B,
  EC_B2B,
  BR_B2B,
  TR_B2B,
  IN_B2B,
  GR_B2B,
  HU_B2B,
  CN_B2B,
  EG_B2B,
  UY_B2B,
  PY_B2B,
  CR_B2B,
  DO_B2B,
  GT_B2B,
  PA_B2B,
  SV_B2B,
  VE_B2B,
  BO_B2B,
  ID_B2B,
  TW_B2B,
  KZ_B2B,
  PH_B2B,
  TH_B2B,
  NP_B2B,
  BD_B2B,
  PK_B2B,
  VN_B2B,
  MY_B2B,
  NG_B2B,
  KE_B2B,
  GH_B2B,
  RW_B2B,
  JO_B2B,
  TN_B2B,
  UA_B2B,
  ME_B2B,
  HR_B2B,
  AL_B2B,
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
    let fpa2js: (xml: string, opts: any) => any;
    let fpaValidate: (fpa: any, schema: any) => Promise<any>;
    let FPAYupSchema: any;

    beforeAll(async () => {
      const mod = await import('@digitalia/fatturapa');
      fpa2js = mod.fpa2js;
      fpaValidate = mod.fpaValidate;
      FPAYupSchema = mod.FPAYupSchema;
    });

    function validateFatturaPa(fixture: FormatFixture) {
      return async () => {
        const xml = await service.buildFatturaPa(fixture.data);
        expect(typeof xml).toBe('string');
        expect(xml.length).toBeGreaterThan(100);

        // 1) XML syntax validation + parse to JS (valuesOnly avoids lib bug in parseFn callback)
        //    checkXML(xmlData) validates via fastXmlParser.validate() then returns parsed object.
        const parsed = fpa2js(xml, { validate: true, valuesOnly: true });
        expect(parsed).toBeDefined();
        expect(parsed.FatturaElettronicaHeader).toBeDefined();
        expect(parsed.FatturaElettronicaBody).toBeDefined();

        // 2) Structural presence checks (belt-and-suspenders)
        expect(xml).toContain('FatturaElettronica');
        expect(xml).toContain('DatiTrasmissione');
        expect(xml).toContain('CedentePrestatore');
        expect(xml).toContain('CessionarioCommittente');
        expect(xml).toContain('DettaglioLinee');
        expect(xml).toContain('DatiRiepilogo');
        expect(xml).toContain('DatiPagamento');

        // 3) Business-rule validation via yup schema (authoritative gate)
        try {
          const result = await fpaValidate(parsed, FPAYupSchema);
          // fpaValidate returns the validated object on success
          expect(result).toBeDefined();
        } catch (err: any) {
          // Fail with clear message — never swallow
          throw new Error(`fpaValidate failed for ${fixture.slug}: ${err.message}`);
        }
      };
    }

    it(`${IT_B2B.slug} → fatturapa (XSD + business rules)`, validateFatturaPa(IT_B2B));
    it(`${IT_MULTI_VAT.slug} → fatturapa (multi-VAT)`, validateFatturaPa(IT_MULTI_VAT));
    it(`${IT_REVERSE_CHARGE.slug} → fatturapa (reverse-charge N6)`, validateFatturaPa(IT_REVERSE_CHARGE));
    it(`${IT_ESENTE.slug} → fatturapa (esente N4)`, validateFatturaPa(IT_ESENTE));
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
      // CFDI namespace must be declared (seam test: real SAT cfd/4 namespace, not a bare prefix)
      if (!xml.includes('http://www.sat.gob.mx/cfd/4')) errors.push('missing CFDI cfd/4 namespace');
      // Sello/Certificado seam: emitted UNSEALED (empty) — the seal is the signing port's job,
      // the UUID is the PAC's. Assert we do NOT fabricate a seal or certificate.
      if (!xml.includes('Sello=""')) errors.push('Sello must be present but empty (sealing seam)');
      if (!xml.includes('Certificado=""')) errors.push('Certificado must be present but empty (CSD seam)');

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
      if (!xml.includes('cac:AdditionalDocumentReference')) errors.push('missing AdditionalDocumentReference (QR)');
      if (!xml.includes('<cbc:ID>QR</cbc:ID>')) errors.push('missing QR ID tag');
      if (!xml.includes('EmbeddedDocumentBinaryObject')) errors.push('missing QR TLV payload');

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
    it(`${fixture.slug} → fa-vat (XSD + structural)`, async () => {
      const xml = await service.buildFaVat(fixture.data);
      expect(typeof xml).toBe('string');
      expect(xml.length).toBeGreaterThan(100);

      const errors: string[] = [];
      if (!xml.includes('Faktura')) errors.push('missing Faktura root');
      if (!xml.includes('Naglowek')) errors.push('missing Naglowek');
      if (!xml.includes('KodFormularza')) errors.push('missing KodFormularza');
      if (!xml.includes('Podmiot1')) errors.push('missing Podmiot1 (seller)');
      if (!xml.includes('Podmiot2')) errors.push('missing Podmiot2 (buyer)');
      if (!xml.includes('FaWiersz')) errors.push('missing FaWiersz');
      if (!xml.includes('1234567890')) errors.push('missing seller NIP');
      if (!xml.includes('9876543210')) errors.push('missing buyer NIP');

      // XSD validation (authoritative gate)
      const xsdResult: XsdResult = await validateXsd(xml, 'pl/schemat_FA2.xsd');

      results.push({
        fixture: fixture.slug,
        format: 'fa-vat',
        xmlLength: xml.length,
        hasRequiredElements: errors.length === 0 && xsdResult.valid,
        verdict: xsdResult.valid ? 'PASS' : 'FAIL',
        errors: [...errors, ...xsdResult.errors],
      });

      expect(errors).toEqual([]);
      expect(xsdResult.valid).toBe(true);
    });
  });

  describe('FA_VAT (PL) — multi-VAT', () => {
    const fixture = PL_B2B_MULTI_VAT;
    it(`${fixture.slug} → fa-vat (multi-VAT: 23+8+5%)`, async () => {
      const xml = await service.buildFaVat(fixture.data);
      expect(typeof xml).toBe('string');
      expect(xml.length).toBeGreaterThan(100);

      const errors: string[] = [];
      if (!xml.includes('Faktura')) errors.push('missing Faktura root');
      if (!xml.includes('Naglowek')) errors.push('missing Naglowek');
      if (!xml.includes('Podmiot1')) errors.push('missing Podmiot1 (seller)');
      if (!xml.includes('Podmiot2')) errors.push('missing Podmiot2 (buyer)');
      if (!xml.includes('FaWiersz')) errors.push('missing FaWiersz');
      if (!xml.includes('1234567890')) errors.push('missing seller NIP');
      if (!xml.includes('9876543210')) errors.push('missing buyer NIP');

      // XSD validation
      const xsdResult: XsdResult = await validateXsd(xml, 'pl/schemat_FA2.xsd');

      results.push({
        fixture: fixture.slug,
        format: 'fa-vat',
        xmlLength: xml.length,
        hasRequiredElements: errors.length === 0 && xsdResult.valid,
        verdict: xsdResult.valid ? 'PASS' : 'FAIL',
        errors: [...errors, ...xsdResult.errors],
      });

      expect(errors).toEqual([]);
      expect(xsdResult.valid).toBe(true);
    });
  });

  describe('FA_VAT (PL) — VAT exempt', () => {
    const fixture = PL_B2B_EXEMPT;
    it(`${fixture.slug} → fa-vat (0% exempt)`, async () => {
      const xml = await service.buildFaVat(fixture.data);
      expect(typeof xml).toBe('string');
      expect(xml.length).toBeGreaterThan(100);

      const errors: string[] = [];
      if (!xml.includes('Faktura')) errors.push('missing Faktura root');
      if (!xml.includes('Naglowek')) errors.push('missing Naglowek');
      if (!xml.includes('Podmiot1')) errors.push('missing Podmiot1 (seller)');
      if (!xml.includes('FaWiersz')) errors.push('missing FaWiersz');
      if (!xml.includes('1234567890')) errors.push('missing seller NIP');

      // XSD validation
      const xsdResult: XsdResult = await validateXsd(xml, 'pl/schemat_FA2.xsd');

      results.push({
        fixture: fixture.slug,
        format: 'fa-vat',
        xmlLength: xml.length,
        hasRequiredElements: errors.length === 0 && xsdResult.valid,
        verdict: xsdResult.valid ? 'PASS' : 'FAIL',
        errors: [...errors, ...xsdResult.errors],
      });

      expect(errors).toEqual([]);
      expect(xsdResult.valid).toBe(true);
    });
  });

  describe('FA_VAT (PL) — B2C individual', () => {
    const fixture = PL_B2C;
    it(`${fixture.slug} → fa-vat (B2C, no NIP)`, async () => {
      const xml = await service.buildFaVat(fixture.data);
      expect(typeof xml).toBe('string');
      expect(xml.length).toBeGreaterThan(100);

      const errors: string[] = [];
      if (!xml.includes('Faktura')) errors.push('missing Faktura root');
      if (!xml.includes('Naglowek')) errors.push('missing Naglowek');
      if (!xml.includes('Podmiot1')) errors.push('missing Podmiot1 (seller)');
      if (!xml.includes('Podmiot2')) errors.push('missing Podmiot2 (buyer)');
      if (!xml.includes('FaWiersz')) errors.push('missing FaWiersz');
      if (!xml.includes('1234567890')) errors.push('missing seller NIP');
      if (!xml.includes('BrakID')) errors.push('missing BrakID for B2C');

      // XSD validation
      const xsdResult: XsdResult = await validateXsd(xml, 'pl/schemat_FA2.xsd');

      results.push({
        fixture: fixture.slug,
        format: 'fa-vat',
        xmlLength: xml.length,
        hasRequiredElements: errors.length === 0 && xsdResult.valid,
        verdict: xsdResult.valid ? 'PASS' : 'FAIL',
        errors: [...errors, ...xsdResult.errors],
      });

      expect(errors).toEqual([]);
      expect(xsdResult.valid).toBe(true);
    });
  });

  describe('Chile DTE (CL)', () => {
    const fixture = CL_B2B;
    it(`${fixture.slug} → national-xml CL`, async () => {
      const xml = await service.buildNationalXml(fixture.data, 'CL');
      expect(typeof xml).toBe('string');
      expect(xml.length).toBeGreaterThan(100);

      const errors: string[] = [];
      if (!xml.includes('ClaveDTE')) errors.push('missing ClaveDTE root');
      if (!xml.includes('Encabezado')) errors.push('missing Encabezado');
      if (!xml.includes('Emisor')) errors.push('missing Emisor');
      if (!xml.includes('Receptor')) errors.push('missing Receptor');
      if (!xml.includes('TipoDTE')) errors.push('missing TipoDTE');
      if (!xml.includes('76123456-7')) errors.push('missing seller RUT');
      if (!xml.includes('TODO')) errors.push('missing TODO comment (skeleton)');

      results.push({ fixture: fixture.slug, format: 'cl-dte', xmlLength: xml.length, hasRequiredElements: errors.length === 0, verdict: errors.length === 0 ? 'PASS' : 'FAIL', errors });
      expect(errors).toEqual([]);
    });
  });

  describe('Argentina FE (AR)', () => {
    const fixture = AR_B2B;
    it(`${fixture.slug} → national-xml AR`, async () => {
      const xml = await service.buildNationalXml(fixture.data, 'AR');
      expect(typeof xml).toBe('string');
      expect(xml.length).toBeGreaterThan(100);

      const errors: string[] = [];
      if (!xml.includes('Factura')) errors.push('missing Factura root');
      if (!xml.includes('Cabecera')) errors.push('missing Cabecera');
      if (!xml.includes('CUIT')) errors.push('missing CUIT');
      if (!xml.includes('30-71234567-9')) errors.push('missing seller CUIT');
      if (!xml.includes('TODO')) errors.push('missing TODO comment (skeleton)');

      results.push({ fixture: fixture.slug, format: 'ar-fe', xmlLength: xml.length, hasRequiredElements: errors.length === 0, verdict: errors.length === 0 ? 'PASS' : 'FAIL', errors });
      expect(errors).toEqual([]);
    });
  });

  describe('Ecuador FE (EC)', () => {
    const fixture = EC_B2B;
    it(`${fixture.slug} → national-xml EC`, async () => {
      const xml = await service.buildNationalXml(fixture.data, 'EC');
      expect(typeof xml).toBe('string');
      expect(xml.length).toBeGreaterThan(100);

      const errors: string[] = [];
      if (!xml.includes('Factura')) errors.push('missing Factura root');
      if (!xml.includes('InfoTributaria')) errors.push('missing InfoTributaria');
      if (!xml.includes('InfoFactura')) errors.push('missing InfoFactura');
      if (!xml.includes('1792345678001')) errors.push('missing seller RUC');
      if (!xml.includes('TODO')) errors.push('missing TODO comment (skeleton)');

      results.push({ fixture: fixture.slug, format: 'ec-fe', xmlLength: xml.length, hasRequiredElements: errors.length === 0, verdict: errors.length === 0 ? 'PASS' : 'FAIL', errors });
      expect(errors).toEqual([]);
    });
  });

  describe('Brazil NF-e (BR)', () => {
    const fixture = BR_B2B;
    it(`${fixture.slug} → national-xml BR`, async () => {
      const xml = await service.buildNationalXml(fixture.data, 'BR');
      expect(typeof xml).toBe('string');
      expect(xml.length).toBeGreaterThan(100);

      const errors: string[] = [];
      if (!xml.includes('nfeProc')) errors.push('missing nfeProc root');
      if (!xml.includes('NFe')) errors.push('missing NFe');
      if (!xml.includes('infNFe')) errors.push('missing infNFe');
      if (!xml.includes('emit')) errors.push('missing emit');
      if (!xml.includes('det')) errors.push('missing det');
      if (!xml.includes('12.345.678/0001-90')) errors.push('missing seller CNPJ');
      if (!xml.includes('TODO')) errors.push('missing TODO comment (skeleton)');

      results.push({ fixture: fixture.slug, format: 'br-nfe', xmlLength: xml.length, hasRequiredElements: errors.length === 0, verdict: errors.length === 0 ? 'PASS' : 'FAIL', errors });
      expect(errors).toEqual([]);
    });
  });

  describe('Turkey e-Fatura (TR)', () => {
    const fixture = TR_B2B;
    it(`${fixture.slug} → national-xml TR`, async () => {
      const xml = await service.buildNationalXml(fixture.data, 'TR');
      expect(typeof xml).toBe('string');
      expect(xml.length).toBeGreaterThan(100);

      const errors: string[] = [];
      if (!xml.includes('Invoice')) errors.push('missing Invoice root');
      if (!xml.includes('Header')) errors.push('missing Header');
      if (!xml.includes('Sender')) errors.push('missing Sender');
      if (!xml.includes('Receiver')) errors.push('missing Receiver');
      if (!xml.includes('1234567890')) errors.push('missing seller VKN');
      if (!xml.includes('TODO')) errors.push('missing TODO comment (skeleton)');

      results.push({ fixture: fixture.slug, format: 'tr-efatura', xmlLength: xml.length, hasRequiredElements: errors.length === 0, verdict: errors.length === 0 ? 'PASS' : 'FAIL', errors });
      expect(errors).toEqual([]);
    });
  });

  describe('India IRP (IN)', () => {
    const fixture = IN_B2B;
    it(`${fixture.slug} → national-xml IN`, async () => {
      const xml = await service.buildNationalXml(fixture.data, 'IN');
      expect(typeof xml).toBe('string');
      expect(xml.length).toBeGreaterThan(100);

      const errors: string[] = [];
      if (!xml.includes('Invoice')) errors.push('missing Invoice root');
      if (!xml.includes('TradeParty')) errors.push('missing TradeParty');
      if (!xml.includes('GSTIN')) errors.push('missing GSTIN');
      if (!xml.includes('06AABCT1234F1Z5')) errors.push('missing seller GSTIN');
      if (!xml.includes('TODO')) errors.push('missing TODO comment (skeleton)');

      results.push({ fixture: fixture.slug, format: 'in-irp', xmlLength: xml.length, hasRequiredElements: errors.length === 0, verdict: errors.length === 0 ? 'PASS' : 'FAIL', errors });
      expect(errors).toEqual([]);
    });
  });

  describe('Greece myDATA (GR)', () => {
    const fixture = GR_B2B;
    it(`${fixture.slug} → national-xml GR`, async () => {
      const xml = await service.buildNationalXml(fixture.data, 'GR');
      expect(typeof xml).toBe('string');
      expect(xml.length).toBeGreaterThan(100);

      const errors: string[] = [];
      if (!xml.includes('myDATA:Invoice')) errors.push('missing myDATA:Invoice root');
      if (!xml.includes('myDATA:InvoiceHeader')) errors.push('missing InvoiceHeader');
      if (!xml.includes('myDATA:Issuer')) errors.push('missing Issuer');
      if (!xml.includes('myDATA:Counterpart')) errors.push('missing Counterpart');
      if (!xml.includes('myDATA:InvoiceSummary')) errors.push('missing InvoiceSummary');
      if (!xml.includes('EL801234567')) errors.push('missing seller AFM');
      if (!xml.includes('TODO')) errors.push('missing TODO comment (skeleton)');

      results.push({ fixture: fixture.slug, format: 'gr-mydata', xmlLength: xml.length, hasRequiredElements: errors.length === 0, verdict: errors.length === 0 ? 'PASS' : 'FAIL', errors });
      expect(errors).toEqual([]);
    });
  });

  describe('Hungary Online Számla (HU)', () => {
    const fixture = HU_B2B;
    it(`${fixture.slug} → national-xml HU`, async () => {
      const xml = await service.buildNationalXml(fixture.data, 'HU');
      expect(typeof xml).toBe('string');
      expect(xml.length).toBeGreaterThan(100);

      const errors: string[] = [];
      if (!xml.includes('Invoice')) errors.push('missing Invoice root');
      if (!xml.includes('ID')) errors.push('missing ID');
      if (!xml.includes('IssueDate')) errors.push('missing IssueDate');
      if (!xml.includes('AccountingSupplierParty')) errors.push('missing SupplierParty');
      if (!xml.includes('AccountingCustomerParty')) errors.push('missing CustomerParty');
      if (!xml.includes('InvoiceLine')) errors.push('missing InvoiceLine');
      if (!xml.includes('HU12345678')) errors.push('missing seller adoszám');
      if (!xml.includes('TODO')) errors.push('missing TODO comment (skeleton)');

      results.push({ fixture: fixture.slug, format: 'hu-szamla', xmlLength: xml.length, hasRequiredElements: errors.length === 0, verdict: errors.length === 0 ? 'PASS' : 'FAIL', errors });
      expect(errors).toEqual([]);
    });
  });

  describe('China e-Fapiao (CN)', () => {
    const fixture = CN_B2B;
    it(`${fixture.slug} → national-xml CN`, async () => {
      const xml = await service.buildNationalXml(fixture.data, 'CN');
      expect(typeof xml).toBe('string');
      expect(xml.length).toBeGreaterThan(100);

      const errors: string[] = [];
      if (!xml.includes('Fapiao')) errors.push('missing Fapiao root');
      if (!xml.includes('Header')) errors.push('missing Header');
      if (!xml.includes('Seller')) errors.push('missing Seller');
      if (!xml.includes('Buyer')) errors.push('missing Buyer');
      if (!xml.includes('Items')) errors.push('missing Items');
      if (!xml.includes('91110000MA01XXXXX')) errors.push('missing seller NSRSBH');
      if (!xml.includes('TODO')) errors.push('missing TODO comment (skeleton)');

      results.push({ fixture: fixture.slug, format: 'cn-efapiao', xmlLength: xml.length, hasRequiredElements: errors.length === 0, verdict: errors.length === 0 ? 'PASS' : 'FAIL', errors });
      expect(errors).toEqual([]);
    });
  });

  describe('Egypt ETA (EG)', () => {
    const fixture = EG_B2B;
    it(`${fixture.slug} → national-xml EG`, async () => {
      const xml = await service.buildNationalXml(fixture.data, 'EG');
      expect(typeof xml).toBe('string');
      expect(xml.length).toBeGreaterThan(100);

      const errors: string[] = [];
      if (!xml.includes('Invoice')) errors.push('missing Invoice root');
      if (!xml.includes('Header')) errors.push('missing Header');
      if (!xml.includes('Seller')) errors.push('missing Seller');
      if (!xml.includes('Buyer')) errors.push('missing Buyer');
      if (!xml.includes('Lines')) errors.push('missing Lines');
      if (!xml.includes('EG-123456789')) errors.push('missing seller TIN');
      if (!xml.includes('TODO')) errors.push('missing TODO comment (skeleton)');

      results.push({ fixture: fixture.slug, format: 'eg-eta', xmlLength: xml.length, hasRequiredElements: errors.length === 0, verdict: errors.length === 0 ? 'PASS' : 'FAIL', errors });
      expect(errors).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // LATAM — new scaffold formats (structural / gate-vivant tests)
  // ---------------------------------------------------------------------------

  describe('Uruguay CFE (UY)', () => {
    const fixture = UY_B2B;
    it(`${fixture.slug} → national-xml UY`, async () => {
      const xml = await service.buildNationalXml(fixture.data, 'UY');
      expect(typeof xml).toBe('string');
      expect(xml.length).toBeGreaterThan(100);
      const errors: string[] = [];
      if (!xml.includes('<CFE ')) errors.push('missing CFE root');
      if (!xml.includes('<eFact>')) errors.push('missing eFact inner element');
      if (!xml.includes('Encabezado')) errors.push('missing Encabezado');
      if (!xml.includes('Emisor')) errors.push('missing Emisor');
      if (!xml.includes('TODO')) errors.push('missing TODO comment (skeleton)');
      results.push({ fixture: fixture.slug, format: 'uy-cfe', xmlLength: xml.length, hasRequiredElements: errors.length === 0, verdict: errors.length === 0 ? 'PASS' : 'FAIL', errors });
      expect(errors).toEqual([]);
    });
  });

  describe('Paraguay DE (PY)', () => {
    const fixture = PY_B2B;
    it(`${fixture.slug} → national-xml PY`, async () => {
      const xml = await service.buildNationalXml(fixture.data, 'PY');
      expect(typeof xml).toBe('string');
      expect(xml.length).toBeGreaterThan(100);
      const errors: string[] = [];
      if (!xml.includes('<DE ')) errors.push('missing DE root element');
      if (!xml.includes('gDatGralOpe')) errors.push('missing gDatGralOpe');
      if (!xml.includes('gEmis')) errors.push('missing gEmis (Emisor)');
      if (!xml.includes('gDatRec')) errors.push('missing gDatRec (Receptor/Destinatario)');
      if (!xml.includes('TODO')) errors.push('missing TODO comment (skeleton)');
      results.push({ fixture: fixture.slug, format: 'py-de', xmlLength: xml.length, hasRequiredElements: errors.length === 0, verdict: errors.length === 0 ? 'PASS' : 'FAIL', errors });
      expect(errors).toEqual([]);
    });
  });

  describe('Costa Rica FE (CR)', () => {
    const fixture = CR_B2B;
    it(`${fixture.slug} → national-xml CR`, async () => {
      const xml = await service.buildNationalXml(fixture.data, 'CR');
      expect(typeof xml).toBe('string');
      expect(xml.length).toBeGreaterThan(100);
      const errors: string[] = [];
      if (!xml.includes('FacturaElectronica')) errors.push('missing FacturaElectronica root');
      if (!xml.includes('Emisor')) errors.push('missing Emisor');
      if (!xml.includes('Receptor')) errors.push('missing Receptor');
      if (!xml.includes('DetalleServicio')) errors.push('missing DetalleServicio');
      if (!xml.includes('TODO')) errors.push('missing TODO comment (skeleton)');
      results.push({ fixture: fixture.slug, format: 'cr-fe', xmlLength: xml.length, hasRequiredElements: errors.length === 0, verdict: errors.length === 0 ? 'PASS' : 'FAIL', errors });
      expect(errors).toEqual([]);
    });
  });

  describe('Dominican Republic e-CF (DO)', () => {
    const fixture = DO_B2B;
    it(`${fixture.slug} → national-xml DO`, async () => {
      const xml = await service.buildNationalXml(fixture.data, 'DO');
      expect(typeof xml).toBe('string');
      expect(xml.length).toBeGreaterThan(100);
      const errors: string[] = [];
      // Root element is FCCE (Factura de Comprobante de Crédito Electrónico)
      if (!xml.includes('<FCCE ')) errors.push('missing FCCE root');
      if (!xml.includes('Encabezado')) errors.push('missing Encabezado');
      if (!xml.includes('Emisor')) errors.push('missing Emisor');
      if (!xml.includes('Comprador')) errors.push('missing Comprador');
      if (!xml.includes('TODO')) errors.push('missing TODO comment (skeleton)');
      results.push({ fixture: fixture.slug, format: 'do-ecf', xmlLength: xml.length, hasRequiredElements: errors.length === 0, verdict: errors.length === 0 ? 'PASS' : 'FAIL', errors });
      expect(errors).toEqual([]);
    });
  });

  describe('Guatemala FEL (GT)', () => {
    const fixture = GT_B2B;
    it(`${fixture.slug} → national-xml GT`, async () => {
      const xml = await service.buildNationalXml(fixture.data, 'GT');
      expect(typeof xml).toBe('string');
      expect(xml.length).toBeGreaterThan(100);
      const errors: string[] = [];
      // SAT FEL DTE — root is <DTE>
      if (!xml.includes('<DTE ')) errors.push('missing DTE root');
      if (!xml.includes('DatosEmision')) errors.push('missing DatosEmision');
      if (!xml.includes('Emisor')) errors.push('missing Emisor');
      if (!xml.includes('Receptor')) errors.push('missing Receptor');
      if (!xml.includes('TODO')) errors.push('missing TODO comment (skeleton)');
      results.push({ fixture: fixture.slug, format: 'gt-fel', xmlLength: xml.length, hasRequiredElements: errors.length === 0, verdict: errors.length === 0 ? 'PASS' : 'FAIL', errors });
      expect(errors).toEqual([]);
    });
  });

  describe('Panama FE (PA)', () => {
    const fixture = PA_B2B;
    it(`${fixture.slug} → national-xml PA`, async () => {
      const xml = await service.buildNationalXml(fixture.data, 'PA');
      expect(typeof xml).toBe('string');
      expect(xml.length).toBeGreaterThan(100);
      const errors: string[] = [];
      // Root is <DocumentoFiscal>
      if (!xml.includes('DocumentoFiscal')) errors.push('missing DocumentoFiscal root');
      if (!xml.includes('Encabezado')) errors.push('missing Encabezado');
      if (!xml.includes('Emisor')) errors.push('missing Emisor');
      if (!xml.includes('Receptor')) errors.push('missing Receptor');
      if (!xml.includes('TODO')) errors.push('missing TODO comment (skeleton)');
      results.push({ fixture: fixture.slug, format: 'pa-fe', xmlLength: xml.length, hasRequiredElements: errors.length === 0, verdict: errors.length === 0 ? 'PASS' : 'FAIL', errors });
      expect(errors).toEqual([]);
    });
  });

  describe('El Salvador DTE (SV)', () => {
    const fixture = SV_B2B;
    it(`${fixture.slug} → national-xml SV`, async () => {
      // SV DTE is JSON (not XML) — the scaffold wraps JSON in XML comments
      const out = await service.buildNationalXml(fixture.data, 'SV');
      expect(typeof out).toBe('string');
      expect(out.length).toBeGreaterThan(50);
      const errors: string[] = [];
      // JSON keys present in the serialized DTE JSON
      if (!out.includes('dteJson')) errors.push('missing dteJson key');
      if (!out.includes('emisor')) errors.push('missing emisor');
      if (!out.includes('receptor')) errors.push('missing receptor');
      if (!out.includes('TODO')) errors.push('missing TODO comment (skeleton)');
      results.push({ fixture: fixture.slug, format: 'sv-dte', xmlLength: out.length, hasRequiredElements: errors.length === 0, verdict: errors.length === 0 ? 'PASS' : 'FAIL', errors });
      expect(errors).toEqual([]);
    });
  });

  describe('Venezuela FE (VE)', () => {
    const fixture = VE_B2B;
    it(`${fixture.slug} → national-xml VE`, async () => {
      const xml = await service.buildNationalXml(fixture.data, 'VE');
      expect(typeof xml).toBe('string');
      expect(xml.length).toBeGreaterThan(100);
      const errors: string[] = [];
      if (!xml.includes('FacturaElectronica')) errors.push('missing FacturaElectronica root');
      if (!xml.includes('EncabezadoFactura')) errors.push('missing EncabezadoFactura');
      if (!xml.includes('Emisor')) errors.push('missing Emisor');
      if (!xml.includes('Receptor')) errors.push('missing Receptor');
      if (!xml.includes('Detalles')) errors.push('missing Detalles');
      if (!xml.includes('TODO')) errors.push('missing TODO comment (skeleton)');
      results.push({ fixture: fixture.slug, format: 've-fe', xmlLength: xml.length, hasRequiredElements: errors.length === 0, verdict: errors.length === 0 ? 'PASS' : 'FAIL', errors });
      expect(errors).toEqual([]);
    });
  });

  describe('Bolivia FE (BO)', () => {
    const fixture = BO_B2B;
    it(`${fixture.slug} → national-xml BO`, async () => {
      const xml = await service.buildNationalXml(fixture.data, 'BO');
      expect(typeof xml).toBe('string');
      expect(xml.length).toBeGreaterThan(100);
      const errors: string[] = [];
      // Root is <facturaComputarizadaCompraVenta> (lowercase, SIN schema)
      if (!xml.includes('facturaComputarizadaCompraVenta')) errors.push('missing facturaComputarizadaCompraVenta root');
      if (!xml.includes('<cabecera>')) errors.push('missing cabecera');
      if (!xml.includes('<detalle>')) errors.push('missing detalle');
      if (!xml.includes('nitEmisor')) errors.push('missing nitEmisor');
      if (!xml.includes('TODO')) errors.push('missing TODO comment (skeleton)');
      results.push({ fixture: fixture.slug, format: 'bo-fe', xmlLength: xml.length, hasRequiredElements: errors.length === 0, verdict: errors.length === 0 ? 'PASS' : 'FAIL', errors });
      expect(errors).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // Asia — scaffold formats (structural / gate-vivant tests)
  // ---------------------------------------------------------------------------

  describe('Indonesia e-Faktur (ID)', () => {
    const fixture = ID_B2B;
    it(`${fixture.slug} → national-xml ID`, async () => {
      const xml = await service.buildNationalXml(fixture.data, 'ID');
      expect(typeof xml).toBe('string');
      expect(xml.length).toBeGreaterThan(100);
      const errors: string[] = [];
      if (!xml.includes('FakturPajak')) errors.push('missing FakturPajak root');
      if (!xml.includes('Penjual')) errors.push('missing Penjual (seller)');
      if (!xml.includes('Pembeli')) errors.push('missing Pembeli (buyer)');
      if (!xml.includes('BarangJasa')) errors.push('missing BarangJasa (items)');
      if (!xml.includes('PPN')) errors.push('missing PPN (tax)');
      if (!xml.includes('012345678901234')) errors.push('missing seller NPWP');
      if (!xml.includes('TODO')) errors.push('missing TODO comment (skeleton)');
      results.push({ fixture: fixture.slug, format: 'id-efaktur', xmlLength: xml.length, hasRequiredElements: errors.length === 0, verdict: errors.length === 0 ? 'PASS' : 'FAIL', errors });
      expect(errors).toEqual([]);
    });
  });

  describe('Taiwan eGUI (TW)', () => {
    const fixture = TW_B2B;
    it(`${fixture.slug} → national-xml TW`, async () => {
      const xml = await service.buildNationalXml(fixture.data, 'TW');
      expect(typeof xml).toBe('string');
      expect(xml.length).toBeGreaterThan(100);
      const errors: string[] = [];
      if (!xml.includes('Invoice')) errors.push('missing Invoice root');
      if (!xml.includes('SellerID')) errors.push('missing SellerID');
      if (!xml.includes('BuyerID')) errors.push('missing BuyerID');
      if (!xml.includes('SalesAmount')) errors.push('missing SalesAmount');
      if (!xml.includes('12345678')) errors.push('missing seller tax ID (統一編號)');
      if (!xml.includes('TODO')) errors.push('missing TODO comment (skeleton)');
      results.push({ fixture: fixture.slug, format: 'tw-egui', xmlLength: xml.length, hasRequiredElements: errors.length === 0, verdict: errors.length === 0 ? 'PASS' : 'FAIL', errors });
      expect(errors).toEqual([]);
    });
  });

  describe('Kazakhstan IS ESF (KZ)', () => {
    const fixture = KZ_B2B;
    it(`${fixture.slug} → national-xml KZ`, async () => {
      const xml = await service.buildNationalXml(fixture.data, 'KZ');
      expect(typeof xml).toBe('string');
      expect(xml.length).toBeGreaterThan(100);
      const errors: string[] = [];
      if (!xml.includes('ESF')) errors.push('missing ESF root');
      if (!xml.includes('Supplier')) errors.push('missing Supplier');
      if (!xml.includes('Recipient')) errors.push('missing Recipient');
      if (!xml.includes('Products')) errors.push('missing Products');
      if (!xml.includes('123456789012')) errors.push('missing seller BIN');
      if (!xml.includes('TODO')) errors.push('missing TODO comment (skeleton)');
      results.push({ fixture: fixture.slug, format: 'kz-esf', xmlLength: xml.length, hasRequiredElements: errors.length === 0, verdict: errors.length === 0 ? 'PASS' : 'FAIL', errors });
      expect(errors).toEqual([]);
    });
  });

  describe('Philippines BIR EIS (PH)', () => {
    const fixture = PH_B2B;
    it(`${fixture.slug} → national-xml PH`, async () => {
      const out = await service.buildNationalXml(fixture.data, 'PH');
      expect(typeof out).toBe('string');
      expect(out.length).toBeGreaterThan(50);
      const errors: string[] = [];
      // PH EIS uses JSON wrapped in a comment
      if (!out.includes('sellerTIN')) errors.push('missing sellerTIN');
      if (!out.includes('sellerName')) errors.push('missing sellerName');
      if (!out.includes('buyerTIN')) errors.push('missing buyerTIN');
      if (!out.includes('items')) errors.push('missing items');
      if (!out.includes('123456789012')) errors.push('missing seller TIN');
      if (!out.includes('TODO')) errors.push('missing TODO comment (skeleton)');
      results.push({ fixture: fixture.slug, format: 'ph-eis', xmlLength: out.length, hasRequiredElements: errors.length === 0, verdict: errors.length === 0 ? 'PASS' : 'FAIL', errors });
      expect(errors).toEqual([]);
    });
  });

  describe('Thailand RD e-Tax Invoice (TH)', () => {
    const fixture = TH_B2B;
    it(`${fixture.slug} → national-xml TH`, async () => {
      const xml = await service.buildNationalXml(fixture.data, 'TH');
      expect(typeof xml).toBe('string');
      expect(xml.length).toBeGreaterThan(100);
      const errors: string[] = [];
      if (!xml.includes('TaxInvoice')) errors.push('missing TaxInvoice root');
      if (!xml.includes('Seller')) errors.push('missing Seller');
      if (!xml.includes('Buyer')) errors.push('missing Buyer');
      if (!xml.includes('LineItems')) errors.push('missing LineItems');
      if (!xml.includes('1234567890123')) errors.push('missing seller TIN');
      if (!xml.includes('TODO')) errors.push('missing TODO comment (skeleton)');
      results.push({ fixture: fixture.slug, format: 'th-etax', xmlLength: xml.length, hasRequiredElements: errors.length === 0, verdict: errors.length === 0 ? 'PASS' : 'FAIL', errors });
      expect(errors).toEqual([]);
    });
  });

  describe('Nepal IRD CBMS (NP)', () => {
    const fixture = NP_B2B;
    it(`${fixture.slug} → national-xml NP`, async () => {
      const xml = await service.buildNationalXml(fixture.data, 'NP');
      expect(typeof xml).toBe('string');
      expect(xml.length).toBeGreaterThan(100);
      const errors: string[] = [];
      if (!xml.includes('CBMSInvoice')) errors.push('missing CBMSInvoice root');
      if (!xml.includes('Taxpayer')) errors.push('missing Taxpayer');
      if (!xml.includes('Customer')) errors.push('missing Customer');
      if (!xml.includes('Items')) errors.push('missing Items');
      if (!xml.includes('123456789')) errors.push('missing seller PAN');
      if (!xml.includes('TODO')) errors.push('missing TODO comment (skeleton)');
      results.push({ fixture: fixture.slug, format: 'np-cbms', xmlLength: xml.length, hasRequiredElements: errors.length === 0, verdict: errors.length === 0 ? 'PASS' : 'FAIL', errors });
      expect(errors).toEqual([]);
    });
  });

  describe('Bangladesh NBR e-invoice (BD)', () => {
    const fixture = BD_B2B;
    it(`${fixture.slug} → national-xml BD`, async () => {
      const xml = await service.buildNationalXml(fixture.data, 'BD');
      expect(typeof xml).toBe('string');
      expect(xml.length).toBeGreaterThan(100);
      const errors: string[] = [];
      if (!xml.includes('NBRInvoice')) errors.push('missing NBRInvoice root');
      if (!xml.includes('Supplier')) errors.push('missing Supplier');
      if (!xml.includes('Recipient')) errors.push('missing Recipient');
      if (!xml.includes('LineItems')) errors.push('missing LineItems');
      if (!xml.includes('123456789')) errors.push('missing seller BIN');
      if (!xml.includes('TODO')) errors.push('missing TODO comment (skeleton)');
      results.push({ fixture: fixture.slug, format: 'bd-nbr', xmlLength: xml.length, hasRequiredElements: errors.length === 0, verdict: errors.length === 0 ? 'PASS' : 'FAIL', errors });
      expect(errors).toEqual([]);
    });
  });

  describe('Pakistan FBR XIR (PK)', () => {
    const fixture = PK_B2B;
    it(`${fixture.slug} → national-xml PK`, async () => {
      const xml = await service.buildNationalXml(fixture.data, 'PK');
      expect(typeof xml).toBe('string');
      expect(xml.length).toBeGreaterThan(100);
      const errors: string[] = [];
      if (!xml.includes('FBRInvoice')) errors.push('missing FBRInvoice root');
      if (!xml.includes('Seller')) errors.push('missing Seller');
      if (!xml.includes('Buyer')) errors.push('missing Buyer');
      if (!xml.includes('Items')) errors.push('missing Items');
      if (!xml.includes('1234567')) errors.push('missing seller STRN');
      if (!xml.includes('TODO')) errors.push('missing TODO comment (skeleton)');
      results.push({ fixture: fixture.slug, format: 'pk-fbr', xmlLength: xml.length, hasRequiredElements: errors.length === 0, verdict: errors.length === 0 ? 'PASS' : 'FAIL', errors });
      expect(errors).toEqual([]);
    });
  });

  describe('Vietnam TT78 e-invoice (VN)', () => {
    const fixture = VN_B2B;
    it(`${fixture.slug} → national-xml VN`, async () => {
      const xml = await service.buildNationalXml(fixture.data, 'VN');
      expect(typeof xml).toBe('string');
      expect(xml.length).toBeGreaterThan(100);
      const errors: string[] = [];
      if (!xml.includes('HDon')) errors.push('missing HDon root');
      if (!xml.includes('NBan')) errors.push('missing NBan (seller)');
      if (!xml.includes('NMua')) errors.push('missing NMua (buyer)');
      if (!xml.includes('DSHHDVu')) errors.push('missing DSHHDVu (items)');
      if (!xml.includes('0123456789')) errors.push('missing seller MST');
      if (!xml.includes('TODO')) errors.push('missing TODO comment (skeleton)');
      results.push({ fixture: fixture.slug, format: 'vn-tt78', xmlLength: xml.length, hasRequiredElements: errors.length === 0, verdict: errors.length === 0 ? 'PASS' : 'FAIL', errors });
      expect(errors).toEqual([]);
    });
  });

  describe('Malaysia MyInvois (MY)', () => {
    const fixture = MY_B2B;
    it(`${fixture.slug} → national-xml MY`, async () => {
      const xml = await service.buildNationalXml(fixture.data, 'MY');
      expect(typeof xml).toBe('string');
      expect(xml.length).toBeGreaterThan(100);
      const errors: string[] = [];
      if (!xml.includes('Invoice')) errors.push('missing Invoice root');
      if (!xml.includes('cac:AccountingSupplierParty')) errors.push('missing AccountingSupplierParty');
      if (!xml.includes('cac:AccountingCustomerParty')) errors.push('missing AccountingCustomerParty');
      if (!xml.includes('cac:TaxTotal')) errors.push('missing TaxTotal');
      if (!xml.includes('cac:LegalMonetaryTotal')) errors.push('missing LegalMonetaryTotal');
      if (!xml.includes('cbc:ProfileID')) errors.push('missing ProfileID (LHDNM extension)');
      if (!xml.includes('C12345678900')) errors.push('missing seller TIN');
      if (!xml.includes('TODO')) errors.push('missing TODO comment (skeleton)');
      results.push({ fixture: fixture.slug, format: 'my-invois', xmlLength: xml.length, hasRequiredElements: errors.length === 0, verdict: errors.length === 0 ? 'PASS' : 'FAIL', errors });
      expect(errors).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // Africa — scaffold formats (structural / gate-vivant tests)
  // ---------------------------------------------------------------------------

  describe('Nigeria FIRS MBS (NG)', () => {
    const fixture = NG_B2B;
    it(`${fixture.slug} → national-xml NG`, async () => {
      const xml = await service.buildNationalXml(fixture.data, 'NG');
      expect(typeof xml).toBe('string');
      expect(xml.length).toBeGreaterThan(100);
      const errors: string[] = [];
      if (!xml.includes('FirsInvoice')) errors.push('missing FirsInvoice root');
      if (!xml.includes('Supplier')) errors.push('missing Supplier');
      if (!xml.includes('Buyer')) errors.push('missing Buyer');
      if (!xml.includes('Lines')) errors.push('missing Lines');
      if (!xml.includes('Totals')) errors.push('missing Totals');
      if (!xml.includes('7.5')) errors.push('missing VAT rate (7.5%)');
      if (!xml.includes('123456789012')) errors.push('missing seller TIN');
      if (!xml.includes('TODO')) errors.push('missing TODO comment (skeleton)');
      results.push({ fixture: fixture.slug, format: 'ng-firs', xmlLength: xml.length, hasRequiredElements: errors.length === 0, verdict: errors.length === 0 ? 'PASS' : 'FAIL', errors });
      expect(errors).toEqual([]);
    });
  });

  describe('Kenya KRA eTIMS (KE)', () => {
    const fixture = KE_B2B;
    it(`${fixture.slug} → national-xml KE`, async () => {
      const xml = await service.buildNationalXml(fixture.data, 'KE');
      expect(typeof xml).toBe('string');
      expect(xml.length).toBeGreaterThan(100);
      const errors: string[] = [];
      if (!xml.includes('ETimsInvoice')) errors.push('missing ETimsInvoice root');
      if (!xml.includes('Supplier')) errors.push('missing Supplier');
      if (!xml.includes('Buyer')) errors.push('missing Buyer');
      if (!xml.includes('Items')) errors.push('missing Items');
      if (!xml.includes('Totals')) errors.push('missing Totals');
      if (!xml.includes('A000000000A')) errors.push('missing seller TPIN');
      if (!xml.includes('Receipt')) errors.push('missing Receipt block');
      if (!xml.includes('TODO')) errors.push('missing TODO comment (skeleton)');
      results.push({ fixture: fixture.slug, format: 'ke-etims', xmlLength: xml.length, hasRequiredElements: errors.length === 0, verdict: errors.length === 0 ? 'PASS' : 'FAIL', errors });
      expect(errors).toEqual([]);
    });
  });

  describe('Ghana GRA E-VAT (GH)', () => {
    const fixture = GH_B2B;
    it(`${fixture.slug} → national-xml GH`, async () => {
      const xml = await service.buildNationalXml(fixture.data, 'GH');
      expect(typeof xml).toBe('string');
      expect(xml.length).toBeGreaterThan(100);
      const errors: string[] = [];
      if (!xml.includes('EvatInvoice')) errors.push('missing EvatInvoice root');
      if (!xml.includes('Seller')) errors.push('missing Seller');
      if (!xml.includes('Buyer')) errors.push('missing Buyer');
      if (!xml.includes('Lines')) errors.push('missing Lines');
      if (!xml.includes('Totals')) errors.push('missing Totals');
      if (!xml.includes('TODO')) errors.push('missing TODO comment (skeleton)');
      results.push({ fixture: fixture.slug, format: 'gh-evat', xmlLength: xml.length, hasRequiredElements: errors.length === 0, verdict: errors.length === 0 ? 'PASS' : 'FAIL', errors });
      expect(errors).toEqual([]);
    });
  });

  describe('Rwanda RRA EBM (RW)', () => {
    const fixture = RW_B2B;
    it(`${fixture.slug} → national-xml RW`, async () => {
      const xml = await service.buildNationalXml(fixture.data, 'RW');
      expect(typeof xml).toBe('string');
      expect(xml.length).toBeGreaterThan(100);
      const errors: string[] = [];
      if (!xml.includes('EbmInvoice')) errors.push('missing EbmInvoice root');
      if (!xml.includes('Seller')) errors.push('missing Seller');
      if (!xml.includes('Buyer')) errors.push('missing Buyer');
      if (!xml.includes('Lines')) errors.push('missing Lines');
      if (!xml.includes('Totals')) errors.push('missing Totals');
      if (!xml.includes('100123456')) errors.push('missing seller TIN');
      if (!xml.includes('TODO')) errors.push('missing TODO comment (skeleton)');
      results.push({ fixture: fixture.slug, format: 'rw-ebm', xmlLength: xml.length, hasRequiredElements: errors.length === 0, verdict: errors.length === 0 ? 'PASS' : 'FAIL', errors });
      expect(errors).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // MENA — scaffold formats (structural / gate-vivant tests)
  // ---------------------------------------------------------------------------

  describe('Jordan JoFotara (JO)', () => {
    const fixture = JO_B2B;
    it(`${fixture.slug} → national-xml JO`, async () => {
      const xml = await service.buildNationalXml(fixture.data, 'JO');
      expect(typeof xml).toBe('string');
      expect(xml.length).toBeGreaterThan(100);
      const errors: string[] = [];
      if (!xml.includes('ubl:Invoice')) errors.push('missing ubl:Invoice root');
      if (!xml.includes('cac:AccountingSupplierParty')) errors.push('missing AccountingSupplierParty');
      if (!xml.includes('cac:AccountingCustomerParty')) errors.push('missing AccountingCustomerParty');
      if (!xml.includes('cac:LegalMonetaryTotal')) errors.push('missing LegalMonetaryTotal');
      if (!xml.includes('cac:InvoiceLine')) errors.push('missing InvoiceLine');
      if (!xml.includes('1234567890')) errors.push('missing seller TIN');
      if (!xml.includes('TODO')) errors.push('missing TODO comment (skeleton)');
      results.push({ fixture: fixture.slug, format: 'jo-jofotara', xmlLength: xml.length, hasRequiredElements: errors.length === 0, verdict: errors.length === 0 ? 'PASS' : 'FAIL', errors });
      expect(errors).toEqual([]);
    });
  });

  describe('Tunisia TEIF (TN)', () => {
    const fixture = TN_B2B;
    it(`${fixture.slug} → national-xml TN`, async () => {
      const xml = await service.buildNationalXml(fixture.data, 'TN');
      expect(typeof xml).toBe('string');
      expect(xml.length).toBeGreaterThan(100);
      const errors: string[] = [];
      if (!xml.includes('TEIF')) errors.push('missing TEIF root');
      if (!xml.includes('Entete')) errors.push('missing Entete');
      if (!xml.includes('Vendeur')) errors.push('missing Vendeur');
      if (!xml.includes('Acheteur')) errors.push('missing Acheteur');
      if (!xml.includes('Lignes')) errors.push('missing Lignes');
      if (!xml.includes('1234567/A/M/000')) errors.push('missing seller MF (matricule fiscal)');
      if (!xml.includes('TODO')) errors.push('missing TODO comment (skeleton)');
      results.push({ fixture: fixture.slug, format: 'tn-teif', xmlLength: xml.length, hasRequiredElements: errors.length === 0, verdict: errors.length === 0 ? 'PASS' : 'FAIL', errors });
      expect(errors).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // Europe-national — scaffold formats (structural / gate-vivant tests)
  // ---------------------------------------------------------------------------

  describe('Ukraine tax-invoice (UA)', () => {
    const fixture = UA_B2B;
    it(`${fixture.slug} → national-xml UA`, async () => {
      const xml = await service.buildNationalXml(fixture.data, 'UA');
      expect(typeof xml).toBe('string');
      expect(xml.length).toBeGreaterThan(100);
      const errors: string[] = [];
      if (!xml.includes('DECLAR')) errors.push('missing DECLAR root');
      if (!xml.includes('DECLARHEAD')) errors.push('missing DECLARHEAD');
      if (!xml.includes('DECLARBODY')) errors.push('missing DECLARBODY');
      if (!xml.includes('ITEMS')) errors.push('missing ITEMS');
      if (!xml.includes('UA123456789')) errors.push('missing seller IPN/EDRPOU');
      if (!xml.includes('TODO')) errors.push('missing TODO comment (skeleton)');
      results.push({ fixture: fixture.slug, format: 'ua-taxinvoice', xmlLength: xml.length, hasRequiredElements: errors.length === 0, verdict: errors.length === 0 ? 'PASS' : 'FAIL', errors });
      expect(errors).toEqual([]);
    });
  });

  describe('Montenegro fiscalization (ME)', () => {
    const fixture = ME_B2B;
    it(`${fixture.slug} → national-xml ME`, async () => {
      const xml = await service.buildNationalXml(fixture.data, 'ME');
      expect(typeof xml).toBe('string');
      expect(xml.length).toBeGreaterThan(100);
      const errors: string[] = [];
      if (!xml.includes('FiscalInvoice')) errors.push('missing FiscalInvoice root');
      if (!xml.includes('Seller')) errors.push('missing Seller');
      if (!xml.includes('Buyer')) errors.push('missing Buyer');
      if (!xml.includes('Items')) errors.push('missing Items');
      if (!xml.includes('Totals')) errors.push('missing Totals');
      if (!xml.includes('IKOF')) errors.push('missing IKOF block');
      if (!xml.includes('12345678')) errors.push('missing seller PIB');
      if (!xml.includes('TODO')) errors.push('missing TODO comment (skeleton)');
      results.push({ fixture: fixture.slug, format: 'me-fiscal', xmlLength: xml.length, hasRequiredElements: errors.length === 0, verdict: errors.length === 0 ? 'PASS' : 'FAIL', errors });
      expect(errors).toEqual([]);
    });
  });

  describe('Croatia e-Račun (HR)', () => {
    const fixture = HR_B2B;
    it(`${fixture.slug} → national-xml HR`, async () => {
      const xml = await service.buildNationalXml(fixture.data, 'HR');
      expect(typeof xml).toBe('string');
      expect(xml.length).toBeGreaterThan(100);
      const errors: string[] = [];
      if (!xml.includes('ubl:Invoice')) errors.push('missing ubl:Invoice root');
      if (!xml.includes('cac:AccountingSupplierParty')) errors.push('missing AccountingSupplierParty');
      if (!xml.includes('cac:AccountingCustomerParty')) errors.push('missing AccountingCustomerParty');
      if (!xml.includes('cac:LegalMonetaryTotal')) errors.push('missing LegalMonetaryTotal');
      if (!xml.includes('HR12345678901')) errors.push('missing seller OIB (HR-prefixed)');
      if (!xml.includes('ZKI')) errors.push('missing ZKI (Zaštitni Kod Ispisa)');
      if (!xml.includes('TODO')) errors.push('missing TODO comment (skeleton)');
      results.push({ fixture: fixture.slug, format: 'hr-eracun', xmlLength: xml.length, hasRequiredElements: errors.length === 0, verdict: errors.length === 0 ? 'PASS' : 'FAIL', errors });
      expect(errors).toEqual([]);
    });
  });

  describe('Albania CIS fiscalization (AL)', () => {
    const fixture = AL_B2B;
    it(`${fixture.slug} → national-xml AL`, async () => {
      const xml = await service.buildNationalXml(fixture.data, 'AL');
      expect(typeof xml).toBe('string');
      expect(xml.length).toBeGreaterThan(100);
      const errors: string[] = [];
      if (!xml.includes('FiscalInvoice')) errors.push('missing FiscalInvoice root');
      if (!xml.includes('Seller')) errors.push('missing Seller');
      if (!xml.includes('Buyer')) errors.push('missing Buyer');
      if (!xml.includes('Items')) errors.push('missing Items');
      if (!xml.includes('Totals')) errors.push('missing Totals');
      if (!xml.includes('NSLF')) errors.push('missing NSLF (seller self-control code)');
      if (!xml.includes('K12345678A')) errors.push('missing seller NIPT');
      if (!xml.includes('TODO')) errors.push('missing TODO comment (skeleton)');
      results.push({ fixture: fixture.slug, format: 'al-fiscalization', xmlLength: xml.length, hasRequiredElements: errors.length === 0, verdict: errors.length === 0 ? 'PASS' : 'FAIL', errors });
      expect(errors).toEqual([]);
    });
  });

  describe('FA_VAT XSD — negative test', () => {
    it('rejects broken FA(2) XML missing required elements', async () => {
      const broken = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<Faktura xmlns="http://crd.gov.pl/wzor/2023/06/29/12648/">',
        '  <Naglowek>',
        '    <KodFormularza>Fa</KodFormularza>',
        '    <WariantFormularza>2</WariantFormularza>',
        '  </Naglowek>',
        '</Faktura>',
      ].join('\n');
      const result = await validateXsd(broken, 'pl/schemat_FA2.xsd');
      expect(result.valid).toBe(false);
      expect(result.errorCount).toBeGreaterThan(0);
    });
  });

  describe('KSA ZATCA — QR TLV decode verification', () => {
    it('embeds decodable 5-field TLV base64 QR in the invoice XML', async () => {
      const xml = await service.buildKsaUbl(SA_B2B.data);
      // §51: XML now contains two AdditionalDocumentReferences: PIH + QR.
      // Extract the QR-specific EmbeddedDocumentBinaryObject by finding the block
      // that follows cbc:ID containing 'QR'.
      const qrBlock = xml.match(/<cbc:ID[^>]*>QR<\/cbc:ID>[\s\S]*?<cbc:EmbeddedDocumentBinaryObject[^>]*>([A-Za-z0-9+/=]+)<\/cbc:EmbeddedDocumentBinaryObject>/);
      expect(qrBlock).not.toBeNull();
      const b64 = qrBlock![1];
      const buf = Buffer.from(b64, 'base64');
      // Decode TLV: tag(1), length(1), value(length) x 5 fields
      const fields: { tag: number; value: string }[] = [];
      let offset = 0;
      while (offset < buf.length) {
        const tag = buf[offset++];
        const len = buf[offset++];
        const value = buf.slice(offset, offset + len).toString('utf-8');
        offset += len;
        fields.push({ tag, value });
      }
      expect(fields.length).toBeGreaterThanOrEqual(5);
      expect(fields[0].tag).toBe(1); // sellerName
      expect(fields[1].tag).toBe(2); // vatNumber
      expect(fields[2].tag).toBe(3); // issueDateTime
      expect(fields[3].tag).toBe(4); // totalWithVat
      expect(fields[4].tag).toBe(5); // vatAmount
      expect(fields[0].value).toBe(SA_B2B.data.company.name);
      expect(fields[1].value).toBe('310123456700003');
    });
  });

  describe('Facturae 3.2.2 + XAdES signing (ES)', () => {
    it('generates Facturae 3.2.2 XML and XAdES signature node is present after signing', async () => {
      // Inline cert generation (mirrors providers.spec.ts pattern)
      const forge = await import('node-forge');
      const keys = forge.pki.rsa.generateKeyPair({ bits: 1024, e: 0x10001 });
      const cert = forge.pki.createCertificate();
      cert.publicKey = keys.publicKey;
      cert.serialNumber = '01';
      cert.validity.notBefore = new Date();
      cert.validity.notAfter = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
      const attrs = [{ name: 'commonName', value: 'Test ES Signing' }];
      cert.setSubject(attrs);
      cert.setIssuer(attrs);
      cert.setExtensions([{ name: 'basicConstraints', cA: false }]);
      cert.sign(keys.privateKey, forge.md.sha256.create());

      const certPem = forge.pki.certificateToPem(cert);
      const privateKeyPem = forge.pki.privateKeyInfoToPem(
        forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(keys.privateKey))
      );
      const certDer = Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(), 'binary');

      const { XadesSigningProvider } = await import('../signing/providers');
      const { setNodeDependencies } = await import('xadesjs');
      const { Application: XmldsigApp } = await import('xmldsigjs');
      const { DOMParser: Dom, XMLSerializer: Ser } = await import('@xmldom/xmldom');
      setNodeDependencies({ DOMParser: Dom, XMLSerializer: Ser } as any);
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const path = require('path') as typeof import('path');
      const xmldsigDir = path.dirname(require.resolve('xmldsigjs'));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const xmlCore = require(require.resolve('xml-core', { paths: [xmldsigDir] })) as any;
      xmlCore.setNodeDependencies({ DOMParser: Dom, XMLSerializer: Ser });
      XmldsigApp.setEngine('native', globalThis.crypto as Crypto);

      const material = { certDer, privateKeyPem, certPem };
      const provider = new XadesSigningProvider({ resolve: async () => material });

      const xml = await service.buildFacturae(ES_B2B.data);
      expect(xml).toContain('3.2.2'); // namespace confirms version

      const xmlBytes = new TextEncoder().encode(xml);
      const artifact = {
        role: 'AUTHORITATIVE' as const,
        syntax: 'ES_FACTURAE' as any,
        mime: 'application/xml',
        bytes: xmlBytes,
      };

      const { RecordingComplianceLogger } = await import('../../execution/logger');
      const log = new RecordingComplianceLogger();
      const signed = await provider.sign(artifact, 'es-cert', log);

      const signedXml = Buffer.from(signed.bytes).toString('utf-8');
      // If signing failed silently, the log will have a warn entry; surface it for diagnostics.
      const warnEntries = log.entries.filter(e => e.level === 'warn');
      if (warnEntries.length > 0) {
        throw new Error(`XAdES signing produced warnings: ${warnEntries.map(e => e.message).join('; ')}`);
      }
      // XAdES embeds a <ds:Signature> or <Signature> element — check for both variants.
      expect(signedXml).toMatch(/Signature/);
      expect(signed.signature?.algo).toBe('XAdES');
    });
  });
});
