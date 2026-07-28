/**
 * BuyerDirectoryPort — abstraction for resolving a buyer's routing endpoint
 * from a directory service (§7 routing via directory).
 *
 * For FR PDP: the AFNOR Directory (XP Z12-013 Annuaire des Participants) resolves
 * a buyer SIREN/SIRET → their PDP routing identifier.
 *
 * For Peppol: the SMP/SML infrastructure resolves a buyer's Peppol participant ID
 * → their Access Point endpoint URL. This port is a higher-level adapter that returns
 * the participant ID (for the AP gateway) rather than the raw SMP result.
 *
 * Offline-safe by default: `NullBuyerDirectory` returns null without making any
 * network calls. Real implementations are wired in via the transmission provider
 * when credentials and network are available.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BuyerDirectoryQuery {
  /**
   * Buyer SIREN (9 digits, FR) or SIRET (14 digits, FR) — for AFNOR Directory.
   * OR the Peppol participant ID (icd:identifier) — for Peppol SMP.
   */
  identifier: string;

  /**
   * Identifier scheme hint (optional).
   * 'SIREN' | 'SIRET' — triggers AFNOR Directory lookup.
   * 'PEPPOL_ID' — triggers SMP lookup.
   * If not provided, the implementation infers from the identifier format.
   */
  scheme?: 'SIREN' | 'SIRET' | 'PEPPOL_ID';

  /** Environment (TEST / PROD). Defaults to 'TEST'. */
  environment?: 'TEST' | 'PROD';
}

export interface BuyerDirectoryResult {
  /**
   * Resolved routing / endpoint identifier for the buyer.
   * For AFNOR: the PDP routing identifier (e.g. "315143296_1422").
   * For Peppol: the Peppol participant ID (icd:identifier).
   */
  endpointId: string;

  /**
   * Optional additional metadata from the directory.
   * For AFNOR: platform type ('WK' | 'DFH'), directory line status.
   */
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Port
// ---------------------------------------------------------------------------

/**
 * Port for buyer routing directory lookup.
 * Implementations: AfnorDirectoryLookup (PDP), SmpBuyerDirectory (Peppol).
 * Default: NullBuyerDirectory (offline-safe, always returns null).
 */
export interface BuyerDirectoryPort {
  /**
   * Resolve a buyer's routing endpoint from the directory.
   * Returns null when:
   *   - The buyer is not registered in the directory.
   *   - The directory is unavailable (implementations should catch and return null).
   *   - The port is a no-op (NullBuyerDirectory).
   */
  lookup(query: BuyerDirectoryQuery): Promise<BuyerDirectoryResult | null>;
}

// ---------------------------------------------------------------------------
// Null implementation (offline-safe default)
// ---------------------------------------------------------------------------

/**
 * No-op directory: always returns null without any network call.
 * Used when no directory credentials / connectivity are configured.
 */
export class NullBuyerDirectory implements BuyerDirectoryPort {
  async lookup(_query: BuyerDirectoryQuery): Promise<BuyerDirectoryResult | null> {
    return null;
  }
}
