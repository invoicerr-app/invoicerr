/**
 * Port for resolving per-company channel credentials (cycle-safe).
 *
 * The compliance module depends only on this port — the implementation lives in
 * the `channel-credentials` module (which imports Prisma, not invoices).
 *
 * This ensures: compliance → port (interface) ← channel-credentials (service)
 * and avoids the compliance ↔ invoices cycle.
 */

/** Decrypted config blob for a specific provider+environment. */
export interface ResolvedChannelConfig {
  /** The provider id (e.g. 'ksef', 'sdi'). */
  providerId: string;
  /** The channel type string. */
  channel: string;
  /** TEST or PROD. */
  environment: string;
  /** Decrypted config object (key-value pairs matching the provider's configSchema). */
  config: Record<string, unknown>;
  /** Whether this config entry is active. */
  isActive: boolean;
}

export interface ChannelCredentialsPort {
  /**
   * Resolve the decrypted, active channel config for a given company+provider+environment.
   * Returns null when no matching row exists or isActive=false.
   */
  resolve(
    companyId: string,
    providerId: string,
    environment: string,
  ): Promise<ResolvedChannelConfig | null>;
}
