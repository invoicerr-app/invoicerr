/**
 * Port for resolving per-company signing credentials (certificate + private key) — reprised
 * verbatim from the repère's `compliance/providers/signing/signing-credentials-port.ts`.
 *
 * This module (the crypto — XAdES/CAdES/PAdES) depends only on this interface; the real
 * implementation (`modules/company/signing-certificates/signing-certificates.service.ts`, Prisma +
 * AES-256-GCM) lives outside and is injected at call time — the exact same split
 * `channels.service.ts`'s own `ChannelCredentialsService` draws between the credentials STORE and
 * whatever consumes the resolved value, and the reason this module never imports Prisma.
 *
 * Security rules (unchanged from the repère):
 *  - NEVER log private keys, p12 passwords, or raw cert material.
 *  - NEVER commit real cert files to the repo (use in-memory test certs, generated with node-forge —
 *    see providers.spec.ts / signing-certificates.service.spec.ts).
 *  - If no cert is configured, return null — the caller logs a note and passes the artifact through
 *    unsigned (never crashes) UNLESS the caller is the PAdES wiring for an ACTIVE cert that failed
 *    mid-signature — see `providers.ts`'s own header on why that ONE case is different.
 */

/** Resolved signing credential material for a single company. */
export interface SigningCredentialsMaterial {
  /** X.509 certificate in DER (binary) format — used for XAdES/CAdES. */
  certDer: Buffer;
  /** PKCS#8 PEM-encoded private key — used for XAdES/CAdES. */
  privateKeyPem: string;
  /** PEM-encoded certificate — convenience for libraries that prefer PEM. */
  certPem: string;
  /**
   * Raw PKCS#12 (PFX) bundle — used by PAdES (@signpdf/signer-p12).
   * Optional: if absent the PAdES provider passes the artifact through unsigned (no PEM fallback —
   * see providers.ts's own header on why PAdES specifically requires a p12Buffer).
   */
  p12Buffer?: Buffer;
  /** Password for the PKCS#12 bundle (must not be logged or persisted in plain). */
  p12Password?: string;
}

/** Port: resolves signing credentials by an opaque certRef string. */
export interface SigningCredentialsPort {
  /**
   * Resolve the credential material for a given certRef (e.g. "{companyId}" or
   * "{companyId}:{algo}" — see `SigningCertificatesService.resolve`'s own header for the exact
   * convention). Returns null when no cert is configured, inactive, or expired — caller must treat
   * as unsigned.
   */
  resolve(certRef: string): Promise<SigningCredentialsMaterial | null>;
}

/**
 * Default implementation — always returns null (no cert configured). Used wherever a real
 * credentials store is not wired up (every non-PAdES caller today — see registry.ts's own header),
 * and as the "no cert" default for the PAdES wiring itself. The signing providers pass artifacts
 * through unsigned with a warn log in that case.
 */
export class NullSigningCredentials implements SigningCredentialsPort {
  async resolve(_certRef: string): Promise<SigningCredentialsMaterial | null> {
    return null;
  }
}
