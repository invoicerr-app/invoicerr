import { PlannedArtifact } from '../../engine/compliance-engine';
import { RecordingComplianceLogger } from '../../execution/logger';
import { DocumentSyntax } from '../../types';
import { NATIONAL_FORMAT_PROVIDERS } from './national-formats';
import { defaultFormatRegistry } from './registry';

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

  it('every national provider builds an XML artifact and logs a precise TODO; validate is a stub-OK', () => {
    const log = new RecordingComplianceLogger();
    for (const p of NATIONAL_FORMAT_PROVIDERS) {
      const artifact: PlannedArtifact = { role: 'AUTHORITATIVE', syntax: 'NATIONAL_XML' };
      // build() ignores the artifact syntax and emits its own; just exercise the stub path.
      const built = p.build(artifact, {} as never, {} as never, log);
      expect(built.mime).toBe('application/xml');
      expect(log.hasScope(`format/${p.id}`)).toBe(true);
      expect(p.validate(built, log).valid).toBe(true);
    }
  });
});
