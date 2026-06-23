import { TransactionContext } from '../../canonical/canonical-document';
import { CompliancePlan, PlannedArtifact } from '../../engine/compliance-engine';
import { ComplianceLogger, defaultLogger } from '../../execution/logger';
import { RenderedArtifact } from '../../execution/types';
import { DocumentSyntax } from '../../types';
import { FormatProvider } from './format-provider';
import {
  CfdiFormatProvider,
  En16931FormatProvider,
  FaVatFormatProvider,
  FatturaPaFormatProvider,
  KsaUblFormatProvider,
  NationalXmlFormatProvider,
  PlainPdfFormatProvider,
} from './providers';

export class FormatProviderRegistry {
  private readonly providers: FormatProvider[];

  constructor(providers?: FormatProvider[]) {
    this.providers = providers ?? [
      new En16931FormatProvider(),
      new PlainPdfFormatProvider(),
      new CfdiFormatProvider(),
      new FatturaPaFormatProvider(),
      new KsaUblFormatProvider(),
      new FaVatFormatProvider(),
      new NationalXmlFormatProvider(),
    ];
  }

  /** National strategies win over the generic EN provider when both could match. */
  resolve(syntax: DocumentSyntax): FormatProvider | null {
    const national = this.providers.find((p) => p.id !== 'en16931' && p.supports(syntax));
    if (national) return national;
    return this.providers.find((p) => p.supports(syntax)) ?? null;
  }

  buildAll(
    ctx: TransactionContext,
    plan: CompliancePlan,
    log: ComplianceLogger = defaultLogger,
  ): RenderedArtifact[] {
    return plan.artifacts.map((artifact: PlannedArtifact) => {
      const provider = this.resolve(artifact.syntax as DocumentSyntax);
      if (!provider) {
        log.warn('format', `no provider for syntax ${artifact.syntax}; emitting empty artifact`);
        return { role: artifact.role as RenderedArtifact['role'], syntax: artifact.syntax as DocumentSyntax, mime: 'application/octet-stream', bytes: new Uint8Array() };
      }
      const built = provider.build(artifact, ctx, plan, log);
      provider.validate(built, log);
      return built;
    });
  }
}

export const defaultFormatRegistry = new FormatProviderRegistry();
