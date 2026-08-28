/**
 * P1-T03b — a real `InvoiceArtifactPort` for tests, backed by the actual rendering pipeline and no
 * database.
 *
 * Extracted verbatim from `execution/peppol-f7-reachability.spec.ts`, which had the only working
 * one. It is needed in more than one place now: `FormatProviderRegistry` built without a rendering
 * port emits ZERO BYTES for every artifact (providers.ts:96-142), so any suite that constructs an
 * executor or a ComplianceService without one is exercising a configuration that production does
 * not have — production wires the port through `ComplianceCoreModule` (see the P1-T03a wiring test).
 *
 * `buildEInvoice()` takes plain data, so this needs neither Prisma nor a live company.
 */
import {
  InvoiceRenderingService,
  type InvoiceRenderData,
} from '../../modules/invoice-rendering/invoice-rendering.service';
import type { InvoiceArtifactPort, XmlExportFormat } from '../providers/format/invoice-artifact-port';
import { FR_B2B_STANDARD } from '../providers/format/__fixtures__/invoices';

const renderService = new InvoiceRenderingService();

/**
 * XML is genuinely rendered: the requested export format is asked of @e-invoice-eu/core from the
 * SAME canonical fixture data whatever syntax is requested, so an artifact can never be quietly
 * derived from another rendered syntax.
 *
 * The national renderers return '' on purpose rather than '<stub/>'. Those providers run real,
 * blocking XSD/Schematron validation, and '<stub/>' is not a valid document for any of them — it
 * would fail the gate instead of taking the "nothing to validate" path. Returning '' keeps them on
 * that path, which is what a suite not exercising them wants.
 */
/**
 * A minimal, structurally valid PDF — the container `embedInPdf()` attaches the CII XML to.
 *
 * P1-T03c needs this because Factur-X is a PDF/A-3 hybrid: without a real container the artifact is
 * zero bytes, and on the French path Factur-X is two of the three artifacts (HUMAN and BUYER). A
 * suite that renders CII but not Factur-X still builds two empty documents.
 */
const MINIMAL_PDF = Buffer.from(
  [
    '%PDF-1.4',
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj',
    'trailer<</Root 1 0 R>>',
    '%%EOF',
  ].join('\n'),
  'utf-8',
);

export function makeArtifactPort(fixtureData: InvoiceRenderData): InvoiceArtifactPort {
  return {
    renderPdf: async () => new Uint8Array(MINIMAL_PDF),
    renderPdfFormat: async (_invoiceId: string, format: string) => {
      const inv = renderService.buildEInvoice(fixtureData);
      return inv.embedInPdf(MINIMAL_PDF, format);
    },
    renderXmlFormat: async (_invoiceId: string, format: XmlExportFormat) => {
      const inv = renderService.buildEInvoice(fixtureData);
      return inv.exportXml(format);
    },
    renderFatturaPa: async () => '',
    renderCfdi: async () => '',
    renderFacturae: async () => '',
    renderKsaUbl: async () => '',
    renderFaVat: async () => '',
    renderNationalXml: async () => '',
  };
}

/**
 * The default port, for suites that only need artifacts to be REAL rather than to be a specific
 * document. Backed by FR_B2B_STANDARD — the canonical French invoice the format fixtures already
 * carry, so nothing new is invented here.
 */
export function defaultArtifactPort(): InvoiceArtifactPort {
  return makeArtifactPort(FR_B2B_STANDARD.data);
}
