import { ExportFormat } from '@fin.cx/einvoice';
import { TransactionContext } from '../../canonical/canonical-document';
import { CompliancePlan, PlannedArtifact } from '../../engine/compliance-engine';
import { ComplianceLogger } from '../../execution/logger';
import { RenderedArtifact, ValidationReport } from '../../execution/types';
import { ArtifactRole, DocumentSyntax } from '../../types';
import { FormatProvider } from './format-provider';
import { InvoiceArtifactPort, XmlExportFormat } from './invoice-artifact-port';

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
  // PEPPOL_BIS → 'ubl' is an approximation; the Peppol CustomizationID will come with provider Peppol #63
  PEPPOL_BIS: 'ubl',
};

/** EN 16931 family (Factur-X, ZUGFeRD, XRechnung, UBL, CII, Peppol BIS, PDF/A-3). Wraps
 *  @fin.cx/einvoice — already a dependency and already used by the current invoice flow. */
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
        const xml = await this.artifacts.renderXmlFormat(ctx.externalRef, xmlFormat);
        const bytes = new TextEncoder().encode(xml);
        return { role: artifact.role as ArtifactRole, syntax, mime: 'application/xml', bytes };
      }
      // 3. No mapping — stub
      log.todo('format/en16931', `render ${syntax} (no format mapping — stub)`);
      return { ...rendered(artifact), mime: syntax === 'PDF_A3' ? 'application/pdf' : 'application/xml' };
    }
    log.todo('format/en16931', `build ${artifact.syntax} via @fin.cx/einvoice (EInvoice.embedInPdf/exportXml)`);
    return { ...rendered(artifact), mime: artifact.syntax === 'PDF_A3' ? 'application/pdf' : 'application/xml' };
  }
  validate(_rendered: RenderedArtifact, log: ComplianceLogger): ValidationReport {
    log.todo('format/en16931', 'validate against EN 16931 Schematron');
    return okValidation('EN16931 validation not implemented (stub)');
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
  validate(): ValidationReport {
    return okValidation('plain PDF has no structured validation');
  }
}

export class CfdiFormatProvider implements FormatProvider {
  readonly id = 'cfdi-4.0';
  supports(syntax: DocumentSyntax): boolean {
    return syntax === 'CFDI';
  }
  async build(artifact: PlannedArtifact, _ctx: TransactionContext, _plan: CompliancePlan, log: ComplianceLogger): Promise<RenderedArtifact> {
    log.todo('format/cfdi', 'build SAT CFDI 4.0 XML (Comprobante, Conceptos, Impuestos, UsoCFDI)');
    return { ...rendered(artifact), mime: 'application/xml' };
  }
  validate(_rendered: RenderedArtifact, log: ComplianceLogger): ValidationReport {
    log.todo('format/cfdi', 'validate against SAT XSD + business rules');
    return okValidation('CFDI validation not implemented (stub)');
  }
}

export class FatturaPaFormatProvider implements FormatProvider {
  readonly id = 'fatturapa-1.2';
  supports(syntax: DocumentSyntax): boolean {
    return syntax === 'FATTURAPA';
  }
  async build(artifact: PlannedArtifact, _ctx: TransactionContext, _plan: CompliancePlan, log: ComplianceLogger): Promise<RenderedArtifact> {
    log.todo('format/fatturapa', 'build FatturaPA 1.2 XML for SdI');
    return { ...rendered(artifact), mime: 'application/xml' };
  }
  validate(_rendered: RenderedArtifact, log: ComplianceLogger): ValidationReport {
    log.todo('format/fatturapa', 'validate against SdI XSD');
    return okValidation('FatturaPA validation not implemented (stub)');
  }
}

export class KsaUblFormatProvider implements FormatProvider {
  readonly id = 'ksa-ubl';
  supports(syntax: DocumentSyntax): boolean {
    return syntax === 'KSA_UBL';
  }
  async build(artifact: PlannedArtifact, _ctx: TransactionContext, _plan: CompliancePlan, log: ComplianceLogger): Promise<RenderedArtifact> {
    log.todo('format/ksa-ubl', 'build ZATCA UBL 2.1 + KSA extension and QR payload');
    return { ...rendered(artifact), mime: 'application/xml' };
  }
  validate(_rendered: RenderedArtifact, log: ComplianceLogger): ValidationReport {
    log.todo('format/ksa-ubl', 'validate against ZATCA rules');
    return okValidation('KSA UBL validation not implemented (stub)');
  }
}

/** Generic national-XML catch-all for clearance countries without a dedicated provider yet
 *  (CL DTE, BR NF-e, AR, EC, TN TEIF…). Keeps every profile wired; replace per country over time. */
export class NationalXmlFormatProvider implements FormatProvider {
  readonly id = 'national-xml';
  supports(syntax: DocumentSyntax): boolean {
    return syntax === 'NATIONAL_XML';
  }
  async build(artifact: PlannedArtifact, ctx: TransactionContext, _plan: CompliancePlan, log: ComplianceLogger): Promise<RenderedArtifact> {
    log.todo('format/national-xml', `build the national clearance XML for ${ctx.supplier.countryCode} (dedicated provider TODO)`);
    return { ...rendered(artifact), mime: 'application/xml' };
  }
  validate(_rendered: RenderedArtifact, log: ComplianceLogger): ValidationReport {
    log.todo('format/national-xml', 'validate against the national schema');
    return okValidation('national XML validation not implemented (stub)');
  }
}

/** Poland — FA_VAT (FA(2)/FA(3)) national XML schema submitted to KSeF. */
export class FaVatFormatProvider implements FormatProvider {
  readonly id = 'fa-vat';
  supports(syntax: DocumentSyntax): boolean {
    return syntax === 'FA_VAT';
  }
  async build(artifact: PlannedArtifact, _ctx: TransactionContext, _plan: CompliancePlan, log: ComplianceLogger): Promise<RenderedArtifact> {
    log.todo('format/fa-vat', 'build Polish FA_VAT (FA(2)/FA(3)) XML for KSeF');
    return { ...rendered(artifact), mime: 'application/xml' };
  }
  validate(_rendered: RenderedArtifact, log: ComplianceLogger): ValidationReport {
    log.todo('format/fa-vat', 'validate against the Ministry of Finance XSD');
    return okValidation('FA_VAT validation not implemented (stub)');
  }
}
