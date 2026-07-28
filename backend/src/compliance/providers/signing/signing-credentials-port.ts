/**
 * Port for resolving per-company signing credentials (certificate + private key).
 *
 * Mirrors ChannelCredentialsPort in structure. The compliance module depends only
 * on this interface — the real implementation lives outside (in the company/cert
 * management module) and is injected at startup.
 *
 * Material is expected to come from an encrypted store (via secret-crypto) so that
 * no plaintext key material ever touches a DB column or log line.
 *
 * Security rules:
 *  - NEVER log private keys, p12 passwords, or raw cert material.
 *  - NEVER commit real cert files to the repo (use in-memory test certs).
 *  - If no cert is configured, return null — the caller logs a note and passes
 *    the artifact through unsigned (never crashes).
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
   * Optional: if absent the PAdES provider falls back to PEM-based signing.
   */
  p12Buffer?: Buffer;
  /** Password for the PKCS#12 bundle (must not be logged or persisted in plain). */
  p12Password?: string;
}

/** Port: resolves signing credentials by an opaque certRef string. */
export interface SigningCredentialsPort {
  /**
   * Resolve the credential material for a given certRef (e.g. "FR-cert").
   * Returns null when no cert is configured — caller must treat as unsigned.
   */
  resolve(certRef: string): Promise<SigningCredentialsMaterial | null>;
}

/**
 * Default implementation — always returns null (no cert configured).
 * Used when no real credentials store is wired up yet.
 * The signing providers will pass artifacts through unsigned with a warn note.
 */
export class NullSigningCredentials implements SigningCredentialsPort {
  async resolve(_certRef: string): Promise<SigningCredentialsMaterial | null> {
    return null;
  }
}
