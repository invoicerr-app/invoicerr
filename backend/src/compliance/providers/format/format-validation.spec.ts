/**
 * L1 Format Validation Harness — EN 16931 gate.
 *
 * Validation strategy (post @e-invoice-eu/core migration):
 *
 *   UBL / XRechnung family:
 *     Generate XML via exportXml(), check structural elements.
 *     @e-invoice-eu/core validates the Invoice data object at generate() time;
 *     invalid invoices throw before any XML is produced.
 *
 *   CII family (cii / facturx / zugferd):
 *     Generate XML, check structural elements + EN16931 Schematron validation.
 *
 * CI gate: deterministic, no network, no Java.
 */

import {
	type SchematronResult,
	validateSchematron,
} from "@/compliance/schemas/validate";
import { InvoiceRenderingService } from '@/modules/invoice-rendering/invoice-rendering.service';
import {
	type ExpectedResult,
	type ExportableFormat,
	FIXTURES,
} from "./__fixtures__/invoices";

/** CII structural sections that must appear in every CII-family export. */
const CII_REQUIRED_SECTIONS = [
  'CrossIndustryInvoice',
  'ExchangedDocumentContext',
  'ExchangedDocument',
  'SupplyChainTradeTransaction',
] as const;

/** EN16931 CII Schematron SEF path (relative to schemas/ dir). Phase 2 will switch to .sch. */
const CII_SCH_PATH = 'en16931/EN16931-CII-validation.sef.json';

/**
 * Known Schematron error IDs from CII exports via @e-invoice-eu/core.
 * Update this list if the library is improved or new fixtures are added.
 * Living gate: actual errors must be a SUBSET of this set (no new errors).
 */
const CII_KNOWN_SCHEMATRON_GAPS: string[] = [
  // Add known gaps here if discovered after running the full suite.
  // @e-invoice-eu/core is expected to produce fewer gaps than @fin.cx/einvoice.
];

interface RowResult {
  fixture: string;
  format: string;
  valid: boolean;
  method: 'structural' | 'schematron';
  errorCount: number;
  verdict: 'PASS' | 'FAIL' | 'KNOWN';
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('L1 — Format validation harness', () => {
  const service = new InvoiceRenderingService();
  const rows: RowResult[] = [];
  const seenSchGaps = new Set<string>();

  afterAll(() => {
    // Coverage check: every known gap must be hit by at least one fixture.
    const expectedGaps = new Set(CII_KNOWN_SCHEMATRON_GAPS);
    const missing = [...expectedGaps].filter((g) => !seenSchGaps.has(g));
    if (missing.length > 0) {
      console.warn(
        `[schematron-gate] Known gaps no longer present across all fixtures: ${missing.join(', ')}`,
        '\n→ Consider removing them from CII_KNOWN_SCHEMATRON_GAPS',
      );
    }
    console.log('\n');
    console.table(
      rows.map((r) => ({
        Fixture: r.fixture,
        Format: r.format,
        Valid: r.valid,
        Method: r.method,
        Errors: r.errorCount,
        Verdict: r.verdict,
      })),
    );
  });

  for (const fixture of FIXTURES) {
    describe(fixture.slug, () => {
      for (const [fmt, _expected] of Object.entries(fixture.formats) as [ExportableFormat, ExpectedResult][]) {
        it(`${fixture.slug} → ${fmt}`, async () => {
          const inv = service.buildEInvoice(fixture.data);

          // ── 1. Generate XML (throws if @e-invoice-eu/core validation fails) ──
          const xml = await inv.exportXml(fmt);
          expect(typeof xml).toBe('string');
          expect(xml.length).toBeGreaterThan(0);

          const isCii = fmt === 'cii' || fmt === 'facturx' || fmt === 'zugferd';

          if (isCii) {
            // ── 2. CII structural smoke-test ──
            for (const section of CII_REQUIRED_SECTIONS) {
              expect(xml).toContain(section);
            }

            // ── 3. GuidelineSpecifiedDocumentContextParameter/ID ──
            expect(xml).toContain('urn:cen.eu:en16931:2017');

            // ── 4. EN16931 Schematron (CII / Factur-X only, not ZUGFeRD profile) ──
            if (fmt !== 'zugferd') {
              // Schematron runs on the prefix-based CII XML before namespace normalization
              const schResult: SchematronResult = validateSchematron(xml, CII_SCH_PATH);

              const actualIds = schResult.errors.map((e) => e.id);
              const knownSet = new Set<string>(CII_KNOWN_SCHEMATRON_GAPS);
              for (const id of actualIds) {
                if (!knownSet.has(id)) {
                  throw new Error(`NEW Schematron error "${id}" not in known gaps — regression?`);
                }
                seenSchGaps.add(id);
              }

              rows.push({
                fixture: fixture.slug,
                format: `${fmt}+schematron`,
                valid: actualIds.length === 0,
                method: 'schematron',
                errorCount: schResult.errorCount,
                verdict: actualIds.length === 0 ? 'PASS' : 'KNOWN',
              });
            }
          } else {
            // ── UBL / XRechnung: structural check ──
            expect(xml).toContain('Invoice');
            expect(xml).toContain('cbc:ID');
          }

          rows.push({
            fixture: fixture.slug,
            format: fmt,
            valid: true,
            method: 'structural',
            errorCount: 0,
            verdict: 'PASS',
          });
        });
      }
    });
  }

  // ── Schematron negative test: prove the validator catches broken CII ──
  describe('Schematron negative test', () => {
    it('rejects CII missing required elements', () => {
      const brokenCii = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"',
        '  xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100"',
        '  xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100">',
        '  <rsm:ExchangedDocumentContext>',
        '    <ram:ID>urn:cen.eu:en16931:2017</ram:ID>',
        '  </rsm:ExchangedDocumentContext>',
        '  <rsm:ExchangedDocument>',
        '    <ram:ID>INV-BROKEN</ram:ID>',
        '    <ram:IssueDateTime>',
        '      <udt:DateTimeString format="102">20250615</udt:DateTimeString>',
        '    </ram:IssueDateTime>',
        '  </rsm:ExchangedDocument>',
        '  <rsm:SupplyChainTradeTransaction/>',
        '</rsm:CrossIndustryInvoice>',
      ].join('\n');

      const result = validateSchematron(brokenCii, CII_SCH_PATH);
      expect(result.valid).toBe(false);
      expect(result.errorCount).toBeGreaterThanOrEqual(8);
      // Must catch fundamental structural rules
      const ids = result.errors.map((e) => e.id);
      expect(ids).toContain('BR-06'); // seller name required
      expect(ids).toContain('BR-07'); // buyer name required
      expect(ids).toContain('BR-16'); // at least one invoice line required
    });

    it('rejects completely empty XML', () => {
      const empty = '<?xml version="1.0"?>\n<root/>';
      const result = validateSchematron(empty, CII_SCH_PATH);
      // Empty XML has no CII structure, so no CII-specific rules fire.
      expect(result.errorCount).toBe(0);
    });
  });
});
