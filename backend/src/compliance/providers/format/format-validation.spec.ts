/**
 * L1 Format Validation Harness — EN 16931 gate.
 *
 * Validation strategy depends on syntax family:
 *
 *   UBL family (ubl):
 *     Round-trip exportXml → EInvoice.fromXml → validate(BUSINESS).
 *     The UBL parser in @fin.cx/einvoice works correctly.
 *
 *   XRechnung (UBL CIUS DE):
 *     Round-trip exportXml → EInvoice.fromXml → validate(BUSINESS).
 *     The UBL parser works, but the data model lacks German CIUS fields:
 *       BR-DE-11: seller contact telephone   (Company.phone not mapped)
 *       BR-DE-12: seller contact email       (Company.email not mapped)
 *       BR-DE-13: buyer EndpointID (Peppol)  (buyer electronic address not mapped)
 *       BR-DE-14: payment means type code    (PaymentMeansCode not mapped)
 *     The gate asserts the error set matches exactly — if it grows or shrinks,
 *     the test signals a regression or a data-model improvement.
 *
 *   CII family (cii / facturx / zugferd):
 *     DO NOT round-trip. @fin.cx/einvoice's fromXml for CII has a confirmed
 *     bug (v5.2.x and v6.x): it produces FX-STRUCT-1 errors on perfectly valid
 *     CII XML (missing ExchangedDocumentContext / ExchangedDocument /
 *     SupplyChainTradeTransaction after round-trip despite them being present
 *     in the exported bytes).
 *
 *     Instead: validate the in-memory EInvoice object directly
 *     (inv.validate(BUSINESS) → valid) + smoke-test the exported bytes for
 *     structural correctness (presence of the 3 required CII sections + correct
 *     guideline ID). Authoritative byte-level validation is delegated to
 *     L2 (Mustang/KoSIT) / L3 (EC ITB).
 *
 * CI gate: deterministic, no network, no Java.
 */
import { EInvoice, ValidationLevel } from '@fin.cx/einvoice';
import { InvoiceRenderingService } from '@/modules/invoice-rendering/invoice-rendering.service';
import { FIXTURES, ExportableFormat, ExpectedResult } from './__fixtures__/invoices';

/** CII structural sections that must appear in every CII-family export. */
const CII_REQUIRED_SECTIONS = [
  'rsm:ExchangedDocumentContext',
  'rsm:ExchangedDocument',
  'rsm:SupplyChainTradeTransaction',
] as const;

interface RowResult {
  fixture: string;
  format: string;
  valid: boolean;
  method: 'round-trip' | 'in-memory+bytes';
  errorCount: number;
  warningCount: number;
  verdict: 'PASS' | 'FAIL';
}

/** Formats whose round-trip through fromXml works (UBL family). */
function isRoundTripSafe(fmt: ExportableFormat): boolean {
  return fmt === 'ubl' || fmt === 'xrechnung';
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('L1 — Format validation harness', () => {
  const service = new InvoiceRenderingService();
  const rows: RowResult[] = [];

  afterAll(() => {
    console.log('\n');
    console.table(
      rows.map((r) => ({
        Fixture: r.fixture,
        Format: r.format,
        Valid: r.valid,
        Method: r.method,
        Errors: r.errorCount,
        Warnings: r.warningCount,
        Verdict: r.verdict,
      })),
    );
  });

  for (const fixture of FIXTURES) {
    describe(fixture.slug, () => {
      for (const [fmt, expected] of Object.entries(fixture.formats) as [ExportableFormat, ExpectedResult][]) {
        it(`${fixture.slug} → ${fmt}`, async () => {
          const inv = service.buildEInvoice(fixture.data);

          if (isRoundTripSafe(fmt)) {
            // ── UBL family: round-trip via fromXml ──
            const xml = await inv.exportXml(fmt as 'ubl' | 'xrechnung');
            expect(typeof xml).toBe('string');
            expect(xml.length).toBeGreaterThan(0);

            const roundTripped = await EInvoice.fromXml(xml);
            const result = await roundTripped.validate(ValidationLevel.BUSINESS);

            const errorCount = result.errors?.length ?? 0;
            const warningCount = result.warnings?.length ?? 0;

            rows.push({
              fixture: fixture.slug,
              format: fmt,
              valid: result.valid,
              method: 'round-trip',
              errorCount,
              warningCount,
              verdict: 'PASS',
            });

            if (expected.knownGap) {
              // XRechnung: exact set of BR-DE errors expected (living gate)
              expect(result.valid).toBe(false);
              const codes = (result.errors ?? []).map((e) => e.code).sort();
              expect(codes).toEqual([...expected.knownGap].sort());
            } else {
              // UBL: must be fully valid
              expect(result.valid).toBe(true);
              expect(errorCount).toBe(0);
              expect(warningCount).toBe(0);
            }

            // Syntax-level round-trip must always succeed
            const syntax = await roundTripped.validate(ValidationLevel.SYNTAX);
            expect(syntax.valid).toBe(true);
            return;
          }

          // ── CII family: in-memory validation + byte-level structural checks ──

          // 1. In-memory validation — the EInvoice object is valid before export
          const inMemResult = await inv.validate(ValidationLevel.BUSINESS);
          expect(inMemResult.valid).toBe(true);
          expect(inMemResult.errors?.length ?? 0).toBe(0);

          // 2. Export to XML
          const xml = await inv.exportXml(fmt as 'cii' | 'facturx' | 'zugferd');
          expect(typeof xml).toBe('string');
          expect(xml.length).toBeGreaterThan(0);

          // 3. Structural smoke-test: required CII sections present
          for (const section of CII_REQUIRED_SECTIONS) {
            expect(xml).toContain(section);
          }

          // 4. GuidelineSpecifiedDocumentContextParameter/ID check
          //    - facturx → urn:cen.eu:en16931:2017
          //    - zugferd → urn:zugferd:* (profile identifier)
          //    - cii     → urn:cen.eu:en16931:2017
          if (fmt === 'zugferd') {
            expect(xml).toContain('urn:zugferd:');
          } else {
            expect(xml).toContain('urn:cen.eu:en16931:2017');
          }

          rows.push({
            fixture: fixture.slug,
            format: fmt,
            valid: inMemResult.valid,
            method: 'in-memory+bytes',
            errorCount: 0,
            warningCount: 0,
            verdict: 'PASS',
          });
        });
      }
    });
  }
});
