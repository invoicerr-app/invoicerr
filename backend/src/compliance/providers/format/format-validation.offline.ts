/**
 * L2 — Offline Format Validation (Schematron / authoritative validators).
 *
 * Opt-in via `FORMAT_VALIDATION_OFFLINE=1`.
 * Runs authoritative validators locally:
 *   - EN 16931 Schematron (ConnectingEurope/eInvoicing-EN16931) via saxon-js
 *   - KoSIT (XRechnung) via Java JAR
 *   - Mustang (Factur-X / ZUGFeRD) via Java JAR
 *
 * NOT run in CI by default — requires Java + downloaded JARs/XSLT.
 * Designed for nightly / local validation to cross-check L1 results.
 *
 * @see docs/format-validation.md for setup instructions
 */
import { InvoiceRenderingService } from '@/modules/invoice-rendering/invoice-rendering.service';
import { FIXTURES, ExportableFormat } from './__fixtures__/invoices';

const OFFLINE_ENABLED = process.env.FORMAT_VALIDATION_OFFLINE === '1';

interface OfflineResult {
  fixture: string;
  format: string;
  valid: boolean;
  errorCount: number;
  errors: string[];
}

/**
 * Validates an XML artefact against the authoritative offline schema.
 *
 * Placeholder — real implementation will shell out to:
 *   - `npx saxon-js -s:artifact.xml -xsl:en16931.sch.xsl` (EN 16931)
 *   - `java -jar koSIT.jar artifact.xml` (XRechnung)
 *   - `java -jar mustang.jar artifact.xml` (Factur-X / ZUGFeRD)
 */
async function validateOffline(xml: string, format: ExportableFormat): Promise<OfflineResult> {
  // TODO: implement once JARs/XSLT are downloaded
  return { fixture: '', format, valid: true, errorCount: 0, errors: [] };
}

const describeOffline = OFFLINE_ENABLED ? describe : describe.skip;

describeOffline('L2 — Offline format validation', () => {
  const service = new InvoiceRenderingService();
  const results: OfflineResult[] = [];

  afterAll(() => {
    console.log('\n[L2] Offline validation results:');
    console.table(results.map((r) => ({
      Fixture: r.fixture,
      Format: r.format,
      Valid: r.valid,
      Errors: r.errorCount,
    })));
  });

  for (const fixture of FIXTURES) {
    describe(fixture.slug, () => {
      for (const fmt of Object.keys(fixture.formats) as ExportableFormat[]) {
        it(`${fixture.slug} → ${fmt} (offline)`, async () => {
          const inv = service.buildEInvoice(fixture.data);
          const xml = await inv.exportXml(fmt as 'ubl' | 'cii' | 'xrechnung' | 'facturx' | 'zugferd');

          const result = await validateOffline(xml, fmt);
          result.fixture = fixture.slug;
          results.push(result);

          // Offline validation must agree with L1 expectations
          expect(result.valid).toBe(fixture.formats[fmt]?.valid ?? true);
        });
      }
    });
  }
});
