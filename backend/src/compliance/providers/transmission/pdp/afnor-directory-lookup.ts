/**
 * AFNOR Directory lookup — resolves a French buyer's PDP routing identifier
 * from the AFNOR Directory Service (XP Z12-013 Annuaire des Participants).
 *
 * The directory is queried via the same `PdpClient` used for invoice submission,
 * authenticated with the seller's PDP OAuth2 credentials. The result maps:
 *   buyer SIREN/SIRET → addressingIdentifier (PDP routing ID, e.g. "315143296_1422")
 *
 * Used by `PdpTransmissionProvider.transmit()` when `buyerEndpointId` is not
 * pre-configured in the company channel settings.
 *
 * Offline-safe: if the PDP client is not provided, or if the SIREN cannot be resolved,
 * this returns null (graceful fallback).
 *
 * LIVE PROOF: DEFERRED — requires live PDP credentials and a registered buyer.
 * All tests use a mocked PdpClient.
 */

import type { BuyerDirectoryPort, BuyerDirectoryQuery, BuyerDirectoryResult } from '../buyer-directory-port';
import type { PdpClient } from './pdp-client';

export class AfnorDirectoryLookup implements BuyerDirectoryPort {
  constructor(
    /**
     * A `PdpClient` instance authenticated with the seller's credentials.
     * Injected as a factory/getter to support lazy token refresh.
     */
    private readonly client: Pick<PdpClient, 'searchDirectoryLines'>,
  ) {}

  async lookup(query: BuyerDirectoryQuery): Promise<BuyerDirectoryResult | null> {
    const { identifier, scheme } = query;
    if (!identifier) return null;

    // Normalise: strip spaces/hyphens common in user-supplied IDs.
    const normalised = identifier.replace(/[\s-]/g, '');

    // Build filter based on scheme or detected length.
    const isSiret = scheme === 'SIRET' || (scheme !== 'SIREN' && normalised.length === 14);
    const isSiren = scheme === 'SIREN' || (scheme !== 'SIRET' && normalised.length === 9);

    if (!isSiret && !isSiren) {
      // Not a French identifier — skip without warning (wrong directory).
      return null;
    }

    try {
      const results = await this.client.searchDirectoryLines(
        isSiret ? { siret: normalised } : { siren: normalised },
        5,
      );

      // Use the first Enabled entry; prefer WK (full PDP partner) over DFH (facturation).
      const entries = results.results.filter((e) => e.directoryLineStatus === 'Enabled');
      const entry = entries.find((e) => e.platformType === 'WK') ?? entries[0];
      if (!entry) return null;

      return {
        endpointId: entry.addressingIdentifier,
        metadata: {
          siren: entry.siren,
          siret: entry.siret,
          platformType: entry.platformType,
          directoryLineStatus: entry.directoryLineStatus,
          routingIdentifier: entry.routingIdentifier,
        },
      };
    } catch {
      // Directory unavailable — graceful fallback.
      return null;
    }
  }
}
