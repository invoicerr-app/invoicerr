import { TransactionContext } from '../../canonical/canonical-document';
import { CompliancePlan, PlannedArtifact } from '../../engine/compliance-engine';
import { ComplianceLogger } from '../../execution/logger';
import { RenderedArtifact, ValidationReport } from '../../execution/types';
import { DocumentSyntax } from '../../types';

/** Builds the bytes of one document syntax from the canonical document (§10). */
export interface FormatProvider {
  readonly id: string;
  supports(syntax: DocumentSyntax): boolean;
  build(
    artifact: PlannedArtifact,
    ctx: TransactionContext,
    plan: CompliancePlan,
    log: ComplianceLogger,
  ): RenderedArtifact;
  validate(rendered: RenderedArtifact, log: ComplianceLogger): ValidationReport;
}
