import { ComplianceLogger } from '../../execution/logger';
import { RenderedArtifact, SignedArtifact } from '../../execution/types';

export type SignAlgo = 'XAdES' | 'CAdES' | 'PAdES' | 'none';

/** Applies a digital signature / seal to a rendered artifact (§10, extends the existing SIGNING plugin). */
export interface SigningProvider {
  readonly algo: SignAlgo;
  sign(rendered: RenderedArtifact, certRef: string, log: ComplianceLogger): SignedArtifact;
}
