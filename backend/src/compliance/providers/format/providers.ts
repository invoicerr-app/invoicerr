import { TransactionContext } from '../../canonical/canonical-document';
import { CompliancePlan, PlannedArtifact } from '../../engine/compliance-engine';
import { ComplianceLogger } from '../../execution/logger';
import { RenderedArtifact, ValidationReport } from '../../execution/types';
import { ArtifactRole, DocumentSyntax } from '../../types';
import { FormatProvider } from './format-provider';

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
  supports(syntax: DocumentSyntax): boolean {
    return En16931FormatProvider.SYNTAXES.includes(syntax);
  }
  build(artifact: PlannedArtifact, _ctx: TransactionContext, _plan: CompliancePlan, log: ComplianceLogger): RenderedArtifact {
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
  supports(syntax: DocumentSyntax): boolean {
    return syntax === 'PLAIN_PDF';
  }
  build(artifact: PlannedArtifact, _ctx: TransactionContext, _plan: CompliancePlan, log: ComplianceLogger): RenderedArtifact {
    log.todo('format/plain-pdf', 'render PDF via existing getInvoicePdf() handlebars template');
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
  build(artifact: PlannedArtifact, _ctx: TransactionContext, _plan: CompliancePlan, log: ComplianceLogger): RenderedArtifact {
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
  build(artifact: PlannedArtifact, _ctx: TransactionContext, _plan: CompliancePlan, log: ComplianceLogger): RenderedArtifact {
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
  build(artifact: PlannedArtifact, _ctx: TransactionContext, _plan: CompliancePlan, log: ComplianceLogger): RenderedArtifact {
    log.todo('format/ksa-ubl', 'build ZATCA UBL 2.1 + KSA extension and QR payload');
    return { ...rendered(artifact), mime: 'application/xml' };
  }
  validate(_rendered: RenderedArtifact, log: ComplianceLogger): ValidationReport {
    log.todo('format/ksa-ubl', 'validate against ZATCA rules');
    return okValidation('KSA UBL validation not implemented (stub)');
  }
}
