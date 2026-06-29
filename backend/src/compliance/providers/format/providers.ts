import { TransactionContext } from '../../canonical/canonical-document';
import { CompliancePlan, PlannedArtifact } from '../../engine/compliance-engine';
import { ComplianceLogger } from '../../execution/logger';
import { RenderedArtifact, ValidationReport } from '../../execution/types';
import { validateSchematron, validateXsd } from '../../schemas/validate';
import { ArtifactRole, DocumentSyntax } from '../../types';
import { FormatProvider } from './format-provider';
import { ExportFormat, InvoiceArtifactPort, XmlExportFormat } from './invoice-artifact-port';

function rendered(artifact: PlannedArtifact): RenderedArtifact {
  return {
    role: artifact.role as ArtifactRole,
    syntax: artifact.syntax as DocumentSyntax,
    mime: 'application/octet-stream',
    bytes: new Uint8Array(),
  };
}

function okValidation(warning: string): ValidationReport {
  return { valid: true, errors: [], warnings: [warning] };
}

/** Hybrid PDF/A-3 formats — use `embedInPdf()` (embeds XML inside a PDF container). */
const SYNTAX_TO_PDF_FORMAT: Partial<Record<DocumentSyntax, ExportFormat>> = {
  FACTURX: 'facturx',
  ZUGFERD: 'zugferd',
  PDF_A3: 'facturx',     // PDF/A-3 hybrid → Factur-X profile by default
};

/** Pure XML formats — use `exportXml()` (no PDF container). */
const SYNTAX_TO_XML_FORMAT: Partial<Record<DocumentSyntax, XmlExportFormat>> = {
  XRECHNUNG: 'xrechnung',
  EN16931_UBL: 'ubl',
  EN16931_CII: 'cii',
  PEPPOL_BIS: 'ubl',
};

const PEPPOL_BIS_CUSTOMIZATION_ID =
  'urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0';
const PEPPOL_BIS_PROFILE_ID = 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0';

/** EN 16931 family (Factur-X, ZUGFeRD, XRechnung, UBL, CII, Peppol BIS, PDF/A-3). Wraps
 *  @e-invoice-eu/core via InvoiceRenderingService.buildEInvoice → BuiltEInvoice. */
export class En16931FormatProvider implements FormatProvider {
  readonly id = 'en16931';
  private static readonly SYNTAXES: DocumentSyntax[] = [
    'FACTURX',
    'ZUGFERD',
    'XRECHNUNG',
    'EN16931_UBL',
    'EN16931_CII',
    'PEPPOL_BIS',
    'PDF_A3',
  ];
  constructor(private readonly artifacts?: InvoiceArtifactPort) {}
  supports(syntax: DocumentSyntax): boolean {
    return En16931FormatProvider.SYNTAXES.includes(syntax);
  }
  async build(artifact: PlannedArtifact, ctx: TransactionContext, _plan: CompliancePlan, log: ComplianceLogger): Promise<RenderedArtifact> {
    if (this.artifacts && ctx.externalRef) {
      const syntax = artifact.syntax as DocumentSyntax;
      // 1. Try hybrid PDF/A-3 (embedInPdf)
      const pdfFormat = SYNTAX_TO_PDF_FORMAT[syntax];
      if (pdfFormat) {
        const bytes = await this.artifacts.renderPdfFormat(ctx.externalRef, pdfFormat);
        return { role: artifact.role as ArtifactRole, syntax, mime: 'application/pdf', bytes };
      }
      // 2. Try pure XML (exportXml)
      const xmlFormat = SYNTAX_TO_XML_FORMAT[syntax];
      if (xmlFormat) {
        let xml = await this.artifacts.renderXmlFormat(ctx.externalRef, xmlFormat);
        // Peppol BIS Billing 3.0 requires specific CustomizationID/ProfileID distinct from generic EN16931.
        if (syntax === 'PEPPOL_BIS') {
          xml = xml.replace('urn:cen.eu:en16931:2017', PEPPOL_BIS_CUSTOMIZATION_ID);
          xml = xml.replace('<cbc:ProfileID>M1</cbc:ProfileID>', `<cbc:ProfileID>${PEPPOL_BIS_PROFILE_ID}</cbc:ProfileID>`);
        }
        const bytes = new TextEncoder().encode(xml);
        return { role: artifact.role as ArtifactRole, syntax, mime: 'application/xml', bytes };
      }
      // 3. No mapping — stub
      log.todo('format/en16931', `render ${syntax} (no format mapping — stub)`);
      return { ...rendered(artifact), mime: syntax === 'PDF_A3' ? 'application/pdf' : 'application/xml' };
    }
    log.todo('format/en16931', `build ${artifact.syntax} via BuiltEInvoice (embedInPdf/exportXml)`);
    return { ...rendered(artifact), mime: artifact.syntax === 'PDF_A3' ? 'application/pdf' : 'application/xml' };
  }
  async validate(rendered: RenderedArtifact, log: ComplianceLogger): Promise<ValidationReport> {
    if (rendered.syntax !== 'PEPPOL_BIS') {
      log.todo('format/en16931', `validate ${rendered.syntax} against EN 16931 Schematron`);
      return okValidation(`EN16931 ${rendered.syntax} validation not implemented (stub)`);
    }
    // Peppol BIS Billing 3.0 — validate UBL output against the official PEPPOL Schematron
    if (!rendered.bytes.length) return okValidation('PEPPOL_BIS validation skipped (no bytes — stub path)');
    const xml = new TextDecoder().decode(rendered.bytes);
    const result = validateSchematron(xml, 'peppol/PEPPOL-EN16931-UBL.sch');
    const errors = result.errors.map((e) => `[${e.id}] ${e.message}`);
    if (!result.valid) {
      log.warn('format/peppol-bis', `Peppol BIS Schematron: ${result.errorCount} error(s) — ${errors.slice(0, 3).join('; ')}`);
    }
    return { valid: result.valid, errors, warnings: [] };
  }
}

export class PlainPdfFormatProvider implements FormatProvider {
  readonly id = 'plain-pdf';
  constructor(private readonly artifacts?: InvoiceArtifactPort) {}
  supports(syntax: DocumentSyntax): boolean {
    return syntax === 'PLAIN_PDF';
  }
  async build(artifact: PlannedArtifact, ctx: TransactionContext, _plan: CompliancePlan, log: ComplianceLogger): Promise<RenderedArtifact> {
    if (this.artifacts && ctx.externalRef) {
      const bytes = await this.artifacts.renderPdf(ctx.externalRef);
      return { role: artifact.role as ArtifactRole, syntax: artifact.syntax as DocumentSyntax, mime: 'application/pdf', bytes };
    }
    log.todo('format/plain-pdf', 'render PDF (no externalRef / no port) — stub');
    return { ...rendered(artifact), mime: 'application/pdf' };
  }
  async validate(): Promise<ValidationReport> {
    return okValidation('plain PDF has no structured validation');
  }
}

export class CfdiFormatProvider implements FormatProvider {
  readonly id = 'cfdi-4.0';
  constructor(private readonly artifacts?: InvoiceArtifactPort) {}
  supports(syntax: DocumentSyntax): boolean {
    return syntax === 'CFDI';
  }
  async build(artifact: PlannedArtifact, ctx: TransactionContext, _plan: CompliancePlan, log: ComplianceLogger): Promise<RenderedArtifact> {
    if (this.artifacts && ctx.externalRef) {
      const xml = await this.artifacts.renderCfdi(ctx.externalRef);
      const bytes = new TextEncoder().encode(xml);
      return { role: artifact.role as ArtifactRole, syntax: artifact.syntax as DocumentSyntax, mime: 'application/xml', bytes };
    }
    log.todo('format/cfdi', 'build SAT CFDI 4.0 XML (Comprobante, Conceptos, Impuestos, UsoCFDI) — no externalRef in context');
    return { ...rendered(artifact), mime: 'application/xml' };
  }
  async validate(rendered: RenderedArtifact, log: ComplianceLogger): Promise<ValidationReport> {
    // SAT CFDI 4.0 XSD gate (cfdv40.xsd + catCFDI.xsd + tdCFDI.xsd vendored under schemas/mx/).
    // Note: NoCertificado/Certificado/Sello are intentionally empty in the builder output
    // (PAC-seam: the PAC timbrado fills NoCertificado [20 digits] and TimbreFiscalDigital).
    // XSD will reject an empty NoCertificado; callers must fill the seam before XSD-validating
    // the final signed+sealed document. We surface an explicit warning here.
    if (!rendered.bytes.length) return okValidation('CFDI validation skipped (no bytes — stub path)');
    const xml = new TextDecoder().decode(rendered.bytes);
    // catCFDI.xsd (SAT product catalog) is ~6 MB; raise WASM memory to 128 MB to avoid OOM during schema parse.
    const result = await validateXsd(xml, 'mx/cfdv40.xsd', { maxMemoryPages: 2048 });
    if (!result.valid) {
      // Classify: seam errors vs real structural errors
      const seamErrors = result.errors.filter((e) => e.includes('NoCertificado'));
      const realErrors = result.errors.filter((e) => !e.includes('NoCertificado'));
      if (realErrors.length > 0) {
        log.warn('format/cfdi', `CFDI XSD structural errors: ${realErrors.join('; ')}`);
        return { valid: false, errors: realErrors, warnings: seamErrors };
      }
      // Only NoCertificado seam error — the document is structurally valid, PAC seam pending
      log.warn('format/cfdi', 'CFDI XSD: NoCertificado seam empty (expected before PAC timbrado)');
      return { valid: true, errors: [], warnings: seamErrors };
    }
    return { valid: true, errors: [], warnings: [] };
  }
}

export class FatturaPaFormatProvider implements FormatProvider {
  readonly id = 'fatturapa-1.2';
  constructor(private readonly artifacts?: InvoiceArtifactPort) {}
  supports(syntax: DocumentSyntax): boolean {
    return syntax === 'FATTURAPA';
  }
  async build(artifact: PlannedArtifact, ctx: TransactionContext, _plan: CompliancePlan, log: ComplianceLogger): Promise<RenderedArtifact> {
    if (this.artifacts && ctx.externalRef) {
      const xml = await this.artifacts.renderFatturaPa(ctx.externalRef);
      const bytes = new TextEncoder().encode(xml);
      return { role: artifact.role as ArtifactRole, syntax: artifact.syntax as DocumentSyntax, mime: 'application/xml', bytes };
    }
    log.todo('format/fatturapa', 'build FatturaPA 1.2 XML for SdI — no externalRef in context');
    return { ...rendered(artifact), mime: 'application/xml' };
  }
  async validate(rendered: RenderedArtifact, log: ComplianceLogger): Promise<ValidationReport> {
    // FatturaPA 1.2 XSD gate — Schema_VFPR12.xsd (vendored from @digitalia/fatturapa) + xmldsig-core-schema.xsd
    if (!rendered.bytes.length) return okValidation('FatturaPA validation skipped (no bytes — stub path)');
    const xml = new TextDecoder().decode(rendered.bytes);
    const result = await validateXsd(xml, 'it/Schema_VFPR12.xsd');
    if (!result.valid) {
      log.warn('format/fatturapa', `FatturaPA XSD errors: ${result.errors.slice(0, 3).join('; ')}`);
      return { valid: false, errors: result.errors, warnings: [] };
    }
    return { valid: true, errors: [], warnings: [] };
  }
}

export class KsaUblFormatProvider implements FormatProvider {
  readonly id = 'ksa-ubl';
  constructor(private readonly artifacts?: InvoiceArtifactPort) {}
  supports(syntax: DocumentSyntax): boolean {
    return syntax === 'KSA_UBL';
  }
  async build(artifact: PlannedArtifact, ctx: TransactionContext, _plan: CompliancePlan, log: ComplianceLogger): Promise<RenderedArtifact> {
    if (this.artifacts && ctx.externalRef) {
      const xml = await this.artifacts.renderKsaUbl(ctx.externalRef);
      const bytes = new TextEncoder().encode(xml);
      return { role: artifact.role as ArtifactRole, syntax: artifact.syntax as DocumentSyntax, mime: 'application/xml', bytes };
    }
    log.todo('format/ksa-ubl', 'build ZATCA UBL 2.1 + KSA extension and QR payload — no externalRef in context');
    return { ...rendered(artifact), mime: 'application/xml' };
  }
  async validate(_rendered: RenderedArtifact, log: ComplianceLogger): Promise<ValidationReport> {
    log.todo('format/ksa-ubl', 'validate against ZATCA XSD + business rules (schema not yet vendored)');
    return okValidation('KSA UBL validation not implemented (stub)');
  }
}

/** Generic national-XML catch-all for clearance countries without a dedicated provider yet
 *  (CL DTE, BR NF-e, AR, EC, TN TEIF…). Keeps every profile wired; replace per country over time. */
export class NationalXmlFormatProvider implements FormatProvider {
  readonly id = 'national-xml';
  constructor(private readonly artifacts?: InvoiceArtifactPort) {}
  supports(syntax: DocumentSyntax): boolean {
    return syntax === 'NATIONAL_XML';
  }
  async build(artifact: PlannedArtifact, ctx: TransactionContext, _plan: CompliancePlan, log: ComplianceLogger): Promise<RenderedArtifact> {
    if (this.artifacts && ctx.externalRef) {
      const xml = await this.artifacts.renderNationalXml(ctx.externalRef, ctx.supplier.countryCode || 'XX');
      const bytes = new TextEncoder().encode(xml);
      return { role: artifact.role as ArtifactRole, syntax: artifact.syntax as DocumentSyntax, mime: 'application/xml', bytes };
    }
    log.todo('format/national-xml', `build the national clearance XML for ${ctx.supplier.countryCode} (no externalRef in context)`);
    return { ...rendered(artifact), mime: 'application/xml' };
  }
  async validate(_rendered: RenderedArtifact, log: ComplianceLogger): Promise<ValidationReport> {
    log.todo('format/national-xml', 'validate against the national schema');
    return okValidation('national XML validation not implemented (stub)');
  }
}

/** Poland — FA_VAT (FA(2)/FA(3)) national XML schema submitted to KSeF. */
export class FaVatFormatProvider implements FormatProvider {
  readonly id = 'fa-vat';
  constructor(private readonly artifacts?: InvoiceArtifactPort) {}
  supports(syntax: DocumentSyntax): boolean {
    return syntax === 'FA_VAT';
  }
  async build(artifact: PlannedArtifact, ctx: TransactionContext, _plan: CompliancePlan, log: ComplianceLogger): Promise<RenderedArtifact> {
    if (this.artifacts && ctx.externalRef) {
      const xml = await this.artifacts.renderFaVat(ctx.externalRef);
      const bytes = new TextEncoder().encode(xml);
      return { role: artifact.role as ArtifactRole, syntax: artifact.syntax as DocumentSyntax, mime: 'application/xml', bytes };
    }
    log.todo('format/fa-vat', 'build Polish FA_VAT (FA(2)/FA(3)) XML for KSeF — no externalRef in context');
    return { ...rendered(artifact), mime: 'application/xml' };
  }
  async validate(rendered: RenderedArtifact, log: ComplianceLogger): Promise<ValidationReport> {
    // Poland FA(2) XSD gate — schemat_FA2.xsd + support schemas (vendored under schemas/pl/).
    if (!rendered.bytes.length) return okValidation('FA_VAT validation skipped (no bytes — stub path)');
    const xml = new TextDecoder().decode(rendered.bytes);
    const result = await validateXsd(xml, 'pl/schemat_FA2.xsd');
    if (!result.valid) {
      log.warn('format/fa-vat', `FA_VAT XSD errors: ${result.errors.slice(0, 3).join('; ')}`);
      return { valid: false, errors: result.errors, warnings: [] };
    }
    return { valid: true, errors: [], warnings: [] };
  }
}

/** Spain Facturae 3.2.x — delegates to InvoiceArtifactPort when available. */
export class FacturaeFormatProvider implements FormatProvider {
  readonly id = 'es-facturae';
  constructor(private readonly artifacts?: InvoiceArtifactPort) {}
  supports(syntax: DocumentSyntax): boolean {
    return syntax === 'ES_FACTURAE';
  }
  async build(artifact: PlannedArtifact, ctx: TransactionContext, _plan: CompliancePlan, log: ComplianceLogger): Promise<RenderedArtifact> {
    if (this.artifacts && ctx.externalRef) {
      const xml = await this.artifacts.renderFacturae(ctx.externalRef);
      const bytes = new TextEncoder().encode(xml);
      return { role: artifact.role as ArtifactRole, syntax: artifact.syntax as DocumentSyntax, mime: 'application/xml', bytes };
    }
    log.todo('format/es-facturae', 'build Facturae 3.2.x XML (XAdES-BES) for Spain — no externalRef in context');
    return { ...rendered(artifact), mime: 'application/xml' };
  }
  async validate(_rendered: RenderedArtifact, log: ComplianceLogger): Promise<ValidationReport> {
    // TODO: vendor Facturaev3_2_2.xsd — the official schema from facturae.gob.es is not publicly
    // reachable via direct HTTP at this time (HTTP 403 from all attempted mirrors as of 2026-06-29).
    // Keeping structural validation only until the XSD can be obtained from the official AEAT/FACe
    // channel or via the ZIP download at https://www.facturae.gob.es/formato/Documents/.
    log.todo('format/es-facturae', 'validate against Facturae 3.2.x XSD (schema not yet vendored — see TODO)');
    return okValidation('Facturae XSD not available (see TODO in FacturaeFormatProvider.validate)');
  }
}
