/**
 * The contract every national format stub declares, and the factory that turns one into a
 * FormatProvider. The specs themselves live one file per country under `national/`.
 */
import { PlannedArtifact } from '../../engine/compliance-engine';
import { ComplianceLogger } from '../../execution/logger';
import { RenderedArtifact, ValidationReport } from '../../execution/types';
import { ArtifactRole, DocumentSyntax } from '../../types';
import { FormatProvider } from './format-provider';

export interface NationalFormatSpec {
  /** Stable provider id, e.g. 'nfe', 'cl-dte'. */
  id: string;
  /** The DocumentSyntax this provider builds (1:1 with the profile's FormatSpec.syntax). */
  syntax: DocumentSyntax;
  /** Human label used in stub messages / validation warnings. */
  label: string;
  /** What the real `build()` must produce (authority schema, signature, key fields). */
  buildHint: string;
  /** What the real `validate()` must check (XSD / business rules). */
  validateHint?: string;
}

export /** Turns a spec into a full FormatProvider whose body is a precise TODO. */
function nationalFormat(spec: NationalFormatSpec): FormatProvider {
  return {
    id: spec.id,
    supports: (syntax: DocumentSyntax) => syntax === spec.syntax,
    build(artifact: PlannedArtifact, _ctx, _plan, log: ComplianceLogger): Promise<RenderedArtifact> {
      log.todo(`format/${spec.id}`, spec.buildHint);
      return Promise.resolve({
        role: artifact.role as ArtifactRole,
        syntax: spec.syntax,
        mime: 'application/xml',
        bytes: new Uint8Array(),
      });
    },
    async validate(_rendered: RenderedArtifact, log: ComplianceLogger): Promise<ValidationReport> {
      log.todo(
        `format/${spec.id}`,
        spec.validateHint ?? `validate ${spec.label} against its national schema`,
      );
      return { valid: true, errors: [], warnings: [`${spec.label} validation not implemented (stub)`] };
    },
  };
}
