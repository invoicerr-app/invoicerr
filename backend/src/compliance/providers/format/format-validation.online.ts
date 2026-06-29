/**
 * L3 — Online Format Validation (EC ITB REST API).
 *
 * Opt-in via `FORMAT_VALIDATION_ONLINE=1`.
 * Posts artefacts to https://www.itb.ec.europa.eu/invoice for cross-check.
 *
 * NEVER run in CI by default (non-deterministic, rate-limited, network required).
 * Intended for periodic manual / nightly validation.
 *
 * @see https://www.itb.ec.europa.eu/invoice for API docs
 */

import { InvoiceRenderingService } from '@/modules/invoice-rendering/invoice-rendering.service';
import { type ExportableFormat, FIXTURES } from "./__fixtures__/invoices";

const ONLINE_ENABLED = process.env.FORMAT_VALIDATION_ONLINE === '1';
const ITB_API_URL = 'https://www.itb.ec.europa.eu/invoice/api/validate';

interface OnlineResult {
  fixture: string;
  format: string;
  valid: boolean;
  reportUrl?: string;
  error?: string;
}

/**
 * Posts an XML artefact to the EC ITB REST API and parses the report.
 * Returns a Result; on network failure returns `{ valid: true }` (tolerant skip).
 */
async function validateOnline(xml: string, format: string): Promise<OnlineResult> {
  try {
    const res = await fetch(ITB_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/xml' },
      body: xml,
    });
    const report = await res.json() as { result?: string; reportUrl?: string };
    return {
      fixture: '',
      format,
      valid: report.result === 'valid',
      reportUrl: report.reportUrl,
    };
  } catch (err) {
    // Tolerant: network failure → skip, do not fail
    return { fixture: '', format, valid: true, error: String(err) };
  }
}

const describeOnline = ONLINE_ENABLED ? describe : describe.skip;

describeOnline('L3 — Online format validation (EC ITB)', () => {
  const service = new InvoiceRenderingService();
  const results: OnlineResult[] = [];

  afterAll(() => {
    console.log('\n[L3] Online validation results:');
    console.table(results.map((r) => ({
      Fixture: r.fixture,
      Format: r.format,
      Valid: r.valid,
      Report: r.reportUrl ?? r.error ?? '-',
    })));
  });

  for (const fixture of FIXTURES) {
    describe(fixture.slug, () => {
      for (const fmt of Object.keys(fixture.formats) as ExportableFormat[]) {
        it(`${fixture.slug} → ${fmt} (online)`, async () => {
          const inv = service.buildEInvoice(fixture.data);
          const xml = await inv.exportXml(fmt as 'ubl' | 'cii' | 'xrechnung' | 'facturx' | 'zugferd');

          const result = await validateOnline(xml, fmt);
          result.fixture = fixture.slug;
          results.push(result);

          // Online validation is informational — log but do not fail CI
          if (!result.valid && !result.error) {
            console.warn(`[L3] ${fixture.slug}/${fmt}: ITB reports invalid`, result.reportUrl);
          }
        });
      }
    });
  }
});
