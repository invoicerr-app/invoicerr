import { ComplianceLogger } from '../../execution/logger';
import { RenderedArtifact, SignedArtifact } from '../../execution/types';

export type SignAlgo = 'XAdES' | 'CAdES' | 'PAdES' | 'none';

/**
 * Baseline signature level per ETSI EN 319 132 / EN 319 122 / EN 319 102.
 *  BES  — Basic Electronic Signature (no timestamp).  Default; offline-safe.
 *  T    — Adds an RFC 3161 SignatureTimeStamp from a TSA.
 *  LT   — Adds revocation material (CRL/OCSP) embedding (seam — not yet implemented).
 *  LTA  — Adds an archive timestamp over the LT material (seam — not yet implemented).
 *
 * LT and LTA are documented seams: the constructors accept these values so the enum
 * is forward-compatible, but the providers currently treat them as T (timestamp only)
 * until revocation embedding is implemented.
 */
export type SignatureLevel = 'BES' | 'T' | 'LT' | 'LTA';

/**
 * Applies a digital signature / seal to a rendered artifact (§10).
 * sign() is async because WebCrypto and PDF-signing libraries are inherently async.
 */
export interface SigningProvider {
  readonly algo: SignAlgo;
  sign(rendered: RenderedArtifact, certRef: string, log: ComplianceLogger): Promise<SignedArtifact>;
}
