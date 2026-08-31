import { SigningLogger } from './signing-logger';
import { SignatureLevel, SignedArtifact, SigningArtifact, SignAlgo } from './signing-types';

export type { SignAlgo, SignatureLevel };

/**
 * Applies a digital signature / seal to a rendered artifact — reprised verbatim from the repère's
 * `compliance/providers/signing/signing-provider.ts`, adapted to this module's own local
 * `SigningArtifact`/`SignedArtifact` (see `signing-types.ts`'s own header for why) and `SigningLogger`
 * (see `signing-logger.ts`'s own header). sign() is async because WebCrypto and PDF-signing libraries
 * are inherently async.
 */
export interface SigningProvider {
  readonly algo: SignAlgo;
  sign(artifact: SigningArtifact, certRef: string, log: SigningLogger): Promise<SignedArtifact>;
}
