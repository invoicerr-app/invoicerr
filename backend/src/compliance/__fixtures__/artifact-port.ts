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
export function makeArtifactPort(fixtureData: InvoiceRenderData): InvoiceArtifactPort {
  return {
    renderPdf: async () => new Uint8Array(),
    renderPdfFormat: async () => new Uint8Array(),
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
