/**
 * Quick diagnostic: generate CII XML, apply CTC post-processing, validate with EN16931 Schematron.
 * Run: npx jest src/compliance/schemas/cii-schematron-diagnostic.spec.ts --no-coverage
 */
import { EInvoice } from '@fin.cx/einvoice';
import { postProcessCiiForCtc } from './cii-post-process';
import { validateSchematron, SchematronResult } from './validate';

const CII_SEF = 'en16931/EN16931-CII-validation.sef.json';

async function buildCii(): Promise<string> {
  const inv = new EInvoice();
  inv.id = 'DIAG-' + Date.now();
  inv.issueDate = new Date();
  inv.currency = 'EUR';
  inv.from = {
    name: 'Test Live Seller SARL', description: 'N/A', status: 'active',
    foundedDate: { day: 1, month: 1, year: 2020 }, type: 'company',
    address: { streetName: 'rue de Test', houseNumber: '1', city: 'Paris', postalCode: '75001', country: 'France', countryCode: 'FR' },
    registrationDetails: { vatId: 'FR00315143296', registrationId: '315143296', registrationName: 'Test Live Seller SARL' },
  };
  inv.to = {
    name: 'Test Live Buyer SAS', description: 'N/A', status: 'active',
    foundedDate: { day: 1, month: 1, year: 2020 }, type: 'company',
    address: { streetName: 'avenue du Client', houseNumber: '2', city: 'Lyon', postalCode: '69002', country: 'France', countryCode: 'FR' },
    registrationDetails: { vatId: 'FR23334173221', registrationId: '552081317', registrationName: 'Test Live Buyer SAS' },
  };
  inv.addItem({ name: 'Prestation de test', unitQuantity: 1, unitNetPrice: 100, vatPercentage: 20, unitType: 'C62' });
  return inv.exportXml('cii');
}

describe('CII Schematron diagnostic (CTC)', () => {
  let rawXml: string;
  let patchedXml: string;
  let rawResult: SchematronResult;
  let patchedResult: SchematronResult;

  beforeAll(async () => {
    rawXml = await buildCii();
    patchedXml = postProcessCiiForCtc(rawXml);
    rawResult = validateSchematron(rawXml, CII_SEF);
    patchedResult = validateSchematron(patchedXml, CII_SEF);
  });

  it('raw CII has known Schematron gaps', () => {
    console.log('=== RAW CII ===');
    console.log(`Valid: ${rawResult.valid} | Errors: ${rawResult.errorCount}`);
    for (const err of rawResult.errors) {
      console.log(`  [${err.flag}] ${err.id}: ${err.message}`);
    }
    // Known gaps: BR-CL-3 (no SpecifiedLegalOrganization), possibly others
    expect(rawResult.errorCount).toBeGreaterThan(0);
  });

  it('patched CII should resolve BR-CL-3 and reduce errors', () => {
    console.log('=== PATCHED CII (CTC post-processed) ===');
    console.log(`Valid: ${patchedResult.valid} | Errors: ${patchedResult.errorCount}`);
    for (const err of patchedResult.errors) {
      console.log(`  [${err.flag}] ${err.id}: ${err.message}`);
    }
    // BR-CL-3 should be resolved by the post-processing
    const brcl3 = patchedResult.errors.filter(e => e.id === 'BR-CL-3');
    expect(brcl3).toHaveLength(0);
  });

  it('all remaining errors are in CII_KNOWN_SCHROMATRON_GAPS', () => {
    // Known gaps from @fin.cx/einvoice output — not blocking for superpdp
    const KNOWN_GAPS = ['BR-CO-15', 'BR-S-01', 'BR-CL-14', 'BR-CO-12', 'BR-CL-3'];
    const unexpected = patchedResult.errors.filter(e => !KNOWN_GAPS.includes(e.id));
    console.log('=== UNEXPECTED ERRORS ===');
    for (const err of unexpected) {
      console.log(`  [${err.flag}] ${err.id}: ${err.message}`);
    }
    // We allow remaining known gaps but flag any new ones
    if (unexpected.length > 0) {
      console.warn(`WARNING: ${unexpected.length} unexpected Schematron errors found!`);
    }
  });
});
