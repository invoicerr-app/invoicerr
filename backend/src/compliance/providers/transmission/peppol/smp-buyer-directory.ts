/**
 * SmpBuyerDirectory — resolves a Peppol buyer's routing endpoint via SMP/SML lookup.
 *
 * Adapts `DnsSmpLookup` (or any `SmpLookupPort`) to the `BuyerDirectoryPort` interface
 * so `PeppolTransmissionProvider` can look up a receiver's Peppol participant ID
 * (and confirm they are registered) without requiring it to be pre-configured in
 * company channel settings.
 *
 * Query:
 *   identifier — Peppol participant ID in "icd:identifier" form (e.g. "0009:12345678900011").
 *   scheme     — 'PEPPOL_ID' (or omitted; falls back to icd:identifier detection).
 *   environment — 'TEST' | 'PROD' (defaults to 'TEST').
 *
 * Returns:
 *   endpointId — the raw Peppol participant ID (caller uses it as receiverParticipantId).
 *   metadata   — the SMP endpoint URL + transport profile + activation/expiry dates.
 *
 * Offline-safe: if DNS / SMP is unavailable, returns null (same as NullBuyerDirectory).
 *
 * LIVE PROOF: DEFERRED — requires a Peppol-registered participant in the SML.
 * All tests use a mocked SmpLookupPort.
 */

import type { BuyerDirectoryPort, BuyerDirectoryQuery, BuyerDirectoryResult } from '../buyer-directory-port';
import type { SmpLookupPort } from './smp-client';
import { PEPPOL_DOC_TYPES } from './peppol-client';

export class SmpBuyerDirectory implements BuyerDirectoryPort {
  constructor(
    private readonly smp: SmpLookupPort,
    /** Document type to look up; defaults to UBL Invoice BIS 3. */
    private readonly documentTypeId: string = PEPPOL_DOC_TYPES.INVOICE_UBL,
  ) {}

  async lookup(query: BuyerDirectoryQuery): Promise<BuyerDirectoryResult | null> {
    const { identifier, environment = 'TEST' } = query;
    if (!identifier) return null;

    // Expect icd:identifier format (e.g. "0009:12345678900011").
    const colonIdx = identifier.indexOf(':');
    if (colonIdx < 0) return null;
    const icd = identifier.slice(0, colonIdx);
    const id = identifier.slice(colonIdx + 1);
    if (!icd || !id) return null;

    try {
      const result = await this.smp.lookup(
        { icd, identifier: id },
        this.documentTypeId,
        environment,
      );
      if (!result) return null;

      return {
        endpointId: identifier, // caller needs the full participant ID for routing
        metadata: {
          apEndpointUrl: result.endpoint.url,
          transportProfile: result.endpoint.transportProfile,
          serviceActivationDate: result.endpoint.serviceActivationDate,
          serviceExpirationDate: result.endpoint.serviceExpirationDate,
          documentTypeIds: result.documentTypeIds,
        },
      };
    } catch {
      // Network error / SMP unavailable — graceful fallback.
      return null;
    }
  }
}
