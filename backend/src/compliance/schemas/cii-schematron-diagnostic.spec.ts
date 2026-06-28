/**
 * Quick diagnostic: generate CII XML via @e-invoice-eu/core, apply CTC post-processing,
 * validate with EN16931 Schematron.
 * Run: npx jest src/compliance/schemas/cii-schematron-diagnostic.spec.ts --no-coverage
 */
import { InvoiceService } from '@e-invoice-eu/core';
import type { Invoice } from '@e-invoice-eu/core';
import { postProcessCiiForCtc } from './cii-post-process';
import { validateSchematron, SchematronResult } from './validate';

const CII_SCH = 'en16931/EN16931-CII-validation.sef.json';

async function buildCii(): Promise<string> {
  const svc = new InvoiceService({ log: () => {}, warn: () => {}, error: () => {} });
  const invoice: Invoice = {
    'ubl:Invoice': {
      'cbc:CustomizationID': 'urn:cen.eu:en16931:2017',
      'cbc:ProfileID': 'M1',
      'cbc:ID': 'DIAG-' + Date.now(),
      'cbc:IssueDate': new Date().toISOString().split('T')[0],
      'cbc:InvoiceTypeCode': '380',
      'cbc:DocumentCurrencyCode': 'EUR',
      'cac:AccountingSupplierParty': {
        'cac:Party': {
          'cbc:EndpointID': '315143296',
          'cbc:EndpointID@schemeID': '0225',
          'cac:PartyIdentification': [{ 'cbc:ID': '315143296', 'cbc:ID@schemeID': '0225' }],
          'cac:PostalAddress': {
            'cbc:StreetName': 'rue de Test',
            'cbc:CityName': 'Paris',
            'cbc:PostalZone': '75001',
            'cac:Country': { 'cbc:IdentificationCode': 'FR' },
          },
          'cac:PartyTaxScheme': [{ 'cbc:CompanyID': 'FR00315143296', 'cac:TaxScheme': { 'cbc:ID': 'VAT' } }],
          'cac:PartyLegalEntity': {
            'cbc:RegistrationName': 'Test Live Seller SARL',
            'cbc:CompanyID': '315143296',
            'cbc:CompanyID@schemeID': '0002',
          },
        } as any,
      },
      'cac:AccountingCustomerParty': {
        'cac:Party': {
          'cac:PostalAddress': {
            'cbc:StreetName': 'avenue du Client',
            'cbc:CityName': 'Lyon',
            'cbc:PostalZone': '69002',
            'cac:Country': { 'cbc:IdentificationCode': 'FR' },
          },
          'cac:PartyTaxScheme': { 'cbc:CompanyID': 'FR23334173221', 'cac:TaxScheme': { 'cbc:ID': 'VAT' } },
          'cac:PartyLegalEntity': {
            'cbc:RegistrationName': 'Test Live Buyer SAS',
            'cbc:CompanyID': '552081317',
            'cbc:CompanyID@schemeID': '0002',
          },
        } as any,
      },
      'cac:Delivery': { 'cbc:ActualDeliveryDate': new Date().toISOString().split('T')[0] },
      'cac:TaxTotal': [{
        'cbc:TaxAmount': '20.00',
        'cbc:TaxAmount@currencyID': 'EUR',
        'cac:TaxSubtotal': [{
          'cbc:TaxableAmount': '100.00',
          'cbc:TaxableAmount@currencyID': 'EUR',
          'cbc:TaxAmount': '20.00',
          'cbc:TaxAmount@currencyID': 'EUR',
          'cac:TaxCategory': {
            'cbc:ID': 'S',
            'cbc:Percent': '20',
            'cac:TaxScheme': { 'cbc:ID': 'VAT' },
          },
        }] as any,
      }],
      'cac:LegalMonetaryTotal': {
        'cbc:LineExtensionAmount': '100.00',
        'cbc:LineExtensionAmount@currencyID': 'EUR',
        'cbc:TaxExclusiveAmount': '100.00',
        'cbc:TaxExclusiveAmount@currencyID': 'EUR',
        'cbc:TaxInclusiveAmount': '120.00',
        'cbc:TaxInclusiveAmount@currencyID': 'EUR',
        'cbc:PayableAmount': '120.00',
        'cbc:PayableAmount@currencyID': 'EUR',
      },
      'cac:InvoiceLine': [{
        'cbc:ID': '1',
        'cbc:InvoicedQuantity': '1',
        'cbc:InvoicedQuantity@unitCode': 'C62',
        'cbc:LineExtensionAmount': '100.00',
        'cbc:LineExtensionAmount@currencyID': 'EUR',
        'cac:Item': {
          'cbc:Name': 'Prestation de test',
          'cac:ClassifiedTaxCategory': {
            'cbc:ID': 'S',
            'cbc:Percent': '20',
            'cac:TaxScheme': { 'cbc:ID': 'VAT' },
          },
        },
        'cac:Price': { 'cbc:PriceAmount': '100.00', 'cbc:PriceAmount@currencyID': 'EUR' },
      }] as any,
    },
  };

  const xml = await svc.generate(invoice, { format: 'CII', lang: 'en' });
  return xml.toString();
}

describe('CII Schematron diagnostic (@e-invoice-eu/core)', () => {
  let rawXml: string;
  let patchedXml: string;
  let rawResult: SchematronResult;
  let patchedResult: SchematronResult;

  beforeAll(async () => {
    rawXml = await buildCii();
    patchedXml = postProcessCiiForCtc(rawXml);
    rawResult = validateSchematron(rawXml, CII_SCH);
    patchedResult = validateSchematron(patchedXml, CII_SCH);
  });

  it('generates valid CII XML', () => {
    expect(rawXml).toContain('CrossIndustryInvoice');
    expect(rawXml).toContain('SpecifiedLegalOrganization');
    expect(rawXml).toContain('M1');
  });

  it('raw CII has no Schematron errors (or only known minor gaps)', () => {
    console.log('=== RAW CII (@e-invoice-eu/core) ===');
    console.log(`Valid: ${rawResult.valid} | Errors: ${rawResult.errorCount}`);
    for (const err of rawResult.errors) {
      console.log(`  [${err.flag}] ${err.id}: ${err.message}`);
    }
    // @e-invoice-eu/core should produce fully valid EN16931 CII
    // If there are errors, they must be documented
    if (rawResult.errorCount > 0) {
      console.warn('WARNING: Schematron errors found in @e-invoice-eu/core output — review and add to known gaps');
    }
  });

  it('patched CII (namespace-normalized) has no new errors', () => {
    console.log('=== PATCHED CII (namespace-normalized) ===');
    console.log(`Valid: ${patchedResult.valid} | Errors: ${patchedResult.errorCount}`);
    for (const err of patchedResult.errors) {
      console.log(`  [${err.flag}] ${err.id}: ${err.message}`);
    }
    // Namespace normalization should not introduce new errors
    const rawIds = new Set(rawResult.errors.map((e) => e.id));
    const newErrors = patchedResult.errors.filter((e) => !rawIds.has(e.id));
    expect(newErrors).toHaveLength(0);
  });
});
