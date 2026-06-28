import { TransactionContext } from '../../canonical/canonical-document';
import { CompliancePlan, PlannedArtifact } from '../../engine/compliance-engine';
import { ComplianceLogger, defaultLogger } from '../../execution/logger';
import { RenderedArtifact } from '../../execution/types';
import { DocumentSyntax } from '../../types';
import { FormatProvider } from './format-provider';
import { InvoiceArtifactPort } from './invoice-artifact-port';
import {
  CfdiFormatProvider,
  En16931FormatProvider,
  FaVatFormatProvider,
  FacturaeFormatProvider,
  FatturaPaFormatProvider,
  KsaUblFormatProvider,
  NationalXmlFormatProvider,
  PlainPdfFormatProvider,
} from './providers';
import { NATIONAL_FORMAT_PROVIDERS } from './national-formats';

export class FormatProviderRegistry {
  private readonly providers: FormatProvider[];

  constructor(providers?: FormatProvider[] | { artifacts?: InvoiceArtifactPort }) {
    if (Array.isArray(providers)) {
      this.providers = providers;
    } else {
      const port = providers?.artifacts;
      this.providers = [
        new En16931FormatProvider(port),
        new PlainPdfFormatProvider(port),
        new CfdiFormatProvider(port),
        new FatturaPaFormatProvider(port),
        new KsaUblFormatProvider(port),
        new FaVatFormatProvider(port),
        new FacturaeFormatProvider(port),
        ...NATIONAL_FORMAT_PROVIDERS, // dedicated national-XML providers (selected by syntax)
        new NationalXmlFormatProvider(port), // generic catch-all stays last as the safety net
      ];
    }
  }

  /** National strategies win over the generic EN provider when both could match. */
  resolve(syntax: DocumentSyntax): FormatProvider | null {
    const national = this.providers.find((p) => p.id !== 'en16931' && p.supports(syntax));
    if (national) return national;
    return this.providers.find((p) => p.supports(syntax)) ?? null;
  }

  async buildAll(
    ctx: TransactionContext,
    plan: CompliancePlan,
    log: ComplianceLogger = defaultLogger,
  ): Promise<RenderedArtifact[]> {
    const results: RenderedArtifact[] = [];
    for (const artifact of plan.artifacts) {
      const provider = this.resolve(artifact.syntax as DocumentSyntax);
      if (!provider) {
        log.warn('format', `no provider for syntax ${artifact.syntax}; emitting empty artifact`);
        results.push({ role: artifact.role as RenderedArtifact['role'], syntax: artifact.syntax as DocumentSyntax, mime: 'application/octet-stream', bytes: new Uint8Array() });
        continue;
      }
      const built = await provider.build(artifact, ctx, plan, log);
      provider.validate(built, log);
      results.push(built);
    }
    return results;
  }
}

export const defaultFormatRegistry = new FormatProviderRegistry();
