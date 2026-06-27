import { ExportFormat } from '@fin.cx/einvoice';
import { PlannedArtifact } from '../../engine/compliance-engine';
import { RecordingComplianceLogger } from '../../execution/logger';
import { TransactionContext } from '../../canonical/canonical-document';
import { DocumentSyntax } from '../../types';
import { NATIONAL_FORMAT_PROVIDERS } from './national-formats';
import { defaultFormatRegistry } from './registry';
import { InvoiceArtifactPort, XmlExportFormat } from './invoice-artifact-port';
import { En16931FormatProvider, PlainPdfFormatProvider } from './providers';

describe('FormatProviderRegistry resolution', () => {
  it('resolves the EN 16931 family to the en16931 provider', () => {
    for (const s of ['FACTURX', 'ZUGFERD', 'XRECHNUNG', 'EN16931_UBL', 'EN16931_CII', 'PEPPOL_BIS', 'PDF_A3'] as DocumentSyntax[]) {
      expect(defaultFormatRegistry.resolve(s)?.id).toBe('en16931');
    }
  });

  it('resolves bespoke + generic providers', () => {
    expect(defaultFormatRegistry.resolve('PLAIN_PDF')?.id).toBe('plain-pdf');
    expect(defaultFormatRegistry.resolve('CFDI')?.id).toBe('cfdi-4.0');
    expect(defaultFormatRegistry.resolve('FATTURAPA')?.id).toBe('fatturapa-1.2');
    expect(defaultFormatRegistry.resolve('KSA_UBL')?.id).toBe('ksa-ubl');
    expect(defaultFormatRegistry.resolve('FA_VAT')?.id).toBe('fa-vat');
    expect(defaultFormatRegistry.resolve('NATIONAL_XML')?.id).toBe('national-xml');
  });

  it('a national syntax resolves to its dedicated provider, never to en16931 or the catch-all', () => {
    for (const s of ['NFE', 'CL_DTE', 'CN_EFAPIAO', 'IN_IRP', 'TR_EFATURA', 'KE_ETIMS'] as DocumentSyntax[]) {
      const id = defaultFormatRegistry.resolve(s)?.id;
      expect(id).toBeDefined();
      expect(id).not.toBe('en16931');
      expect(id).not.toBe('national-xml');
    }
  });

  it('an unknown syntax resolves to null', () => {
    expect(defaultFormatRegistry.resolve('TOTALLY_UNKNOWN' as DocumentSyntax)).toBeNull();
  });

  it('national provider ids and syntaxes are unique', () => {
    const ids = NATIONAL_FORMAT_PROVIDERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every national provider builds an XML artifact and logs a precise TODO; validate is a stub-OK', async () => {
    const log = new RecordingComplianceLogger();
    for (const p of NATIONAL_FORMAT_PROVIDERS) {
      const artifact: PlannedArtifact = { role: 'AUTHORITATIVE', syntax: 'NATIONAL_XML' };
      // build() ignores the artifact syntax and emits its own; just exercise the stub path.
      const built = await p.build(artifact, {} as never, {} as never, log);
      expect(built.mime).toBe('application/xml');
      expect(log.hasScope(`format/${p.id}`)).toBe(true);
      expect(p.validate(built, log).valid).toBe(true);
    }
  });
});

/** Minimal fake port for unit tests. */
function fakePort(overrides?: Partial<InvoiceArtifactPort>): InvoiceArtifactPort {
  const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
  const formatBytes = new Uint8Array([0x3c, 0x3f, 0x78, 0x6d]); // <?xm
  return {
    renderPdf: async (_id: string) => pdfBytes,
    renderPdfFormat: async (_id: string, _format: '' | 'pdf' | ExportFormat) => formatBytes,
    renderXmlFormat: async (_id: string, _format: XmlExportFormat) => '<xml/>',
    ...overrides,
  };
}

function ctxWithRef(ref?: string): TransactionContext {
  return {
    supplier: { legalName: 'X', countryCode: 'FR', role: 'B2B', identifiers: [] },
    buyer: { legalName: 'Y', countryCode: 'FR', role: 'B2B', identifiers: [] },
    lines: [],
    issueDate: new Date(),
    currency: 'EUR',
    externalRef: ref,
  } as TransactionContext;
}

describe('PlainPdfFormatProvider — real rendering', () => {
  it('delegates to InvoiceArtifactPort.renderPdf when port + externalRef are present', async () => {
    const port = fakePort();
    const provider = new PlainPdfFormatProvider(port);
    const log = new RecordingComplianceLogger();
    const artifact: PlannedArtifact = { role: 'AUTHORITATIVE', syntax: 'PLAIN_PDF' };
    const built = await provider.build(artifact, ctxWithRef('inv-42'), {} as never, log);
    expect(built.bytes).toEqual(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
    expect(built.mime).toBe('application/pdf');
  });

  it('falls back to stub when no externalRef', async () => {
    const port = fakePort();
    const provider = new PlainPdfFormatProvider(port);
    const log = new RecordingComplianceLogger();
    const artifact: PlannedArtifact = { role: 'AUTHORITATIVE', syntax: 'PLAIN_PDF' };
    const built = await provider.build(artifact, ctxWithRef(undefined), {} as never, log);
    expect(built.bytes.byteLength).toBe(0);
    expect(log.hasScope('format/plain-pdf')).toBe(true);
  });

  it('falls back to stub when no port', async () => {
    const provider = new PlainPdfFormatProvider();
    const log = new RecordingComplianceLogger();
    const artifact: PlannedArtifact = { role: 'AUTHORITATIVE', syntax: 'PLAIN_PDF' };
    const built = await provider.build(artifact, ctxWithRef('inv-42'), {} as never, log);
    expect(built.bytes.byteLength).toBe(0);
    expect(log.hasScope('format/plain-pdf')).toBe(true);
  });
});

describe('En16931FormatProvider — real rendering', () => {
  it('delegates to renderPdfFormat for FACTURX syntax (lowercase format)', async () => {
    const receivedFormats: string[] = [];
    const port = fakePort({
      renderPdfFormat: async (_id: string, format: '' | 'pdf' | ExportFormat) => {
        receivedFormats.push(format);
        return new Uint8Array([0x25, 0x50, 0x44, 0x46]);
      },
    });
    const provider = new En16931FormatProvider(port);
    const log = new RecordingComplianceLogger();
    const artifact: PlannedArtifact = { role: 'AUTHORITATIVE', syntax: 'FACTURX' };
    const built = await provider.build(artifact, ctxWithRef('inv-99'), {} as never, log);
    expect(built.mime).toBe('application/pdf');
    expect(built.bytes).toEqual(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
    expect(receivedFormats).toEqual(['facturx']);
  });

  it('delegates to renderPdfFormat for ZUGFERD syntax (lowercase format)', async () => {
    const receivedFormats: string[] = [];
    const port = fakePort({
      renderPdfFormat: async (_id: string, format: '' | 'pdf' | ExportFormat) => {
        receivedFormats.push(format);
        return new Uint8Array([0x25, 0x50, 0x44, 0x46]);
      },
    });
    const provider = new En16931FormatProvider(port);
    const log = new RecordingComplianceLogger();
    const artifact: PlannedArtifact = { role: 'AUTHORITATIVE', syntax: 'ZUGFERD' };
    const built = await provider.build(artifact, ctxWithRef('inv-99'), {} as never, log);
    expect(built.mime).toBe('application/pdf');
    expect(receivedFormats).toEqual(['zugferd']);
  });

  it('delegates to renderPdfFormat for PDF_A3 syntax', async () => {
    const port = fakePort();
    const provider = new En16931FormatProvider(port);
    const log = new RecordingComplianceLogger();
    const artifact: PlannedArtifact = { role: 'AUTHORITATIVE', syntax: 'PDF_A3' };
    const built = await provider.build(artifact, ctxWithRef('inv-99'), {} as never, log);
    expect(built.bytes.byteLength).toBeGreaterThan(0);
    expect(built.mime).toBe('application/pdf');
  });

  it('renders pure XML for EN16931_UBL syntax via renderXmlFormat', async () => {
    const receivedFormats: string[] = [];
    const port = fakePort({
      renderXmlFormat: async (_id: string, format: XmlExportFormat) => {
        receivedFormats.push(format);
        return '<cbc:ID>UBL</cbc:ID>';
      },
    });
    const provider = new En16931FormatProvider(port);
    const log = new RecordingComplianceLogger();
    const artifact: PlannedArtifact = { role: 'AUTHORITATIVE', syntax: 'EN16931_UBL' };
    const built = await provider.build(artifact, ctxWithRef('inv-99'), {} as never, log);
    expect(built.mime).toBe('application/xml');
    expect(built.bytes.byteLength).toBeGreaterThan(0);
    expect(new TextDecoder().decode(built.bytes)).toBe('<cbc:ID>UBL</cbc:ID>');
    expect(receivedFormats).toEqual(['ubl']);
  });

  it('renders pure XML for XRECHNUNG syntax via renderXmlFormat', async () => {
    const receivedFormats: string[] = [];
    const port = fakePort({
      renderXmlFormat: async (_id: string, format: XmlExportFormat) => {
        receivedFormats.push(format);
        return '<rsm:CrossIndustryInvoice>XRechnung</rsm:CrossIndustryInvoice>';
      },
    });
    const provider = new En16931FormatProvider(port);
    const log = new RecordingComplianceLogger();
    const artifact: PlannedArtifact = { role: 'AUTHORITATIVE', syntax: 'XRECHNUNG' };
    const built = await provider.build(artifact, ctxWithRef('inv-99'), {} as never, log);
    expect(built.mime).toBe('application/xml');
    expect(built.bytes.byteLength).toBeGreaterThan(0);
    expect(new TextDecoder().decode(built.bytes)).toContain('XRechnung');
    expect(receivedFormats).toEqual(['xrechnung']);
  });

  it('renders pure XML for EN16931_CII syntax via renderXmlFormat', async () => {
    const receivedFormats: string[] = [];
    const port = fakePort({
      renderXmlFormat: async (_id: string, format: XmlExportFormat) => {
        receivedFormats.push(format);
        return '<rsm:CrossIndustryInvoice/>';
      },
    });
    const provider = new En16931FormatProvider(port);
    const log = new RecordingComplianceLogger();
    const artifact: PlannedArtifact = { role: 'AUTHORITATIVE', syntax: 'EN16931_CII' };
    const built = await provider.build(artifact, ctxWithRef('inv-99'), {} as never, log);
    expect(built.mime).toBe('application/xml');
    expect(built.bytes.byteLength).toBeGreaterThan(0);
    expect(receivedFormats).toEqual(['cii']);
  });

  it('renders pure XML for PEPPOL_BIS syntax (ubl approximation)', async () => {
    const receivedFormats: string[] = [];
    const port = fakePort({
      renderXmlFormat: async (_id: string, format: XmlExportFormat) => {
        receivedFormats.push(format);
        return '<Invoice>Peppol</Invoice>';
      },
    });
    const provider = new En16931FormatProvider(port);
    const log = new RecordingComplianceLogger();
    const artifact: PlannedArtifact = { role: 'AUTHORITATIVE', syntax: 'PEPPOL_BIS' };
    const built = await provider.build(artifact, ctxWithRef('inv-99'), {} as never, log);
    expect(built.mime).toBe('application/xml');
    expect(built.bytes.byteLength).toBeGreaterThan(0);
    expect(receivedFormats).toEqual(['ubl']);
  });

  it('falls back to stub when no externalRef', async () => {
    const port = fakePort();
    const provider = new En16931FormatProvider(port);
    const log = new RecordingComplianceLogger();
    const artifact: PlannedArtifact = { role: 'AUTHORITATIVE', syntax: 'FACTURX' };
    const built = await provider.build(artifact, ctxWithRef(undefined), {} as never, log);
    expect(built.bytes.byteLength).toBe(0);
    expect(log.hasScope('format/en16931')).toBe(true);
  });

  it('falls back to stub when no port', async () => {
    const provider = new En16931FormatProvider();
    const log = new RecordingComplianceLogger();
    const artifact: PlannedArtifact = { role: 'AUTHORITATIVE', syntax: 'FACTURX' };
    const built = await provider.build(artifact, ctxWithRef('inv-99'), {} as never, log);
    expect(built.bytes.byteLength).toBe(0);
    expect(log.hasScope('format/en16931')).toBe(true);
  });
});
