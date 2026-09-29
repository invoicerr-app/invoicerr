import { Injectable, Logger } from '@nestjs/common';

import { fetchPhotonSuggestions } from './photon-client';
import { AddressAutocompleteCapabilityDto, AddressSuggestionDto } from './dto/address-suggestion.dto';

/**
 * Issue #197 - address autocomplete through a self-chosen Photon server.
 *
 * Nominatim's own usage policy forbids exactly this ("you must not implement [autocomplete] on the
 * client side using the API"), so Photon (komoot, same OSM data, built for type-ahead) is the only
 * provider this feature talks to. Photon is worldwide, keyless and self-hostable, but its own terms
 * are fair-use only ("we do not give guarantees for availability... extensive usage will be
 * throttled or completely banned") - Invoicerr is self-hosted by many instances, and every one of
 * them querying the free komoot.io demo server on every keystroke by default would get the whole
 * project banned at once. So this is OFF unless an operator opts in.
 *
 * `ADDRESS_AUTOCOMPLETE_URL` is that one opt-in variable, empty by default - same pattern as
 * `OCR_SERVICE_URL` (`plugins/ocr/providers/local/local.ts`'s own header): no DB row, no Settings
 * screen, read straight from `process.env` on every call rather than cached at boot, so a value
 * changed by redeploying the container takes effect on the very next request. Two documented
 * choices for an operator: `https://photon.komoot.io` for a small instance under its fair-use
 * terms, or a self-hosted Photon container (a multi-GB to 100GB+ index, hence never bundled) for a
 * large one - see `.env.example` and the self-hosting docs for both.
 *
 * This proxy is the ONLY thing that ever calls Photon: the frontend calls this backend
 * (`address-autocomplete.controller.ts`), never a third party directly, so the operator's own choice
 * of server stays server-side, the rate limit below applies per instance rather than per browser,
 * and a self-hosted user's browser never leaks their typed address to komoot.io behind their back.
 */
@Injectable()
export class AddressAutocompleteService {
  private readonly logger = new Logger(AddressAutocompleteService.name);

  /** Below this, a query is barely a query - matches the frontend's own "search from 3 characters"
   *  rule, enforced again here so a caller bypassing the UI can't turn this into a 1-character-per-
   *  keystroke proxy for whatever server the operator configured. */
  private static readonly MIN_QUERY_LENGTH = 3;
  private static readonly MAX_RESULTS = 5;

  private configuredBaseUrl(): string | undefined {
    return process.env.ADDRESS_AUTOCOMPLETE_URL?.trim() || undefined;
  }

  /** Read by the frontend BEFORE it ever fires a suggestion request - the empty-by-default case
   *  (`enabled: false`) is what lets the field make ZERO network calls rather than firing one that
   *  would just come back empty. See `frontend/src/hooks/use-address-autocomplete.ts`'s own header. */
  capability(): AddressAutocompleteCapabilityDto {
    return { enabled: Boolean(this.configuredBaseUrl()) };
  }

  /**
   * Never throws. `ADDRESS_AUTOCOMPLETE_URL` unset, a query under the minimum length, a Photon
   * timeout, a non-2xx response or a malformed body all resolve to an empty list - the field itself
   * must never depend on the service being up (#197), so a degraded proxy answers "no suggestions",
   * never a 502/504 the frontend would have to special-case.
   */
  async search(rawQuery: string): Promise<AddressSuggestionDto[]> {
    const query = (rawQuery ?? '').trim();
    if (query.length < AddressAutocompleteService.MIN_QUERY_LENGTH) return [];

    const baseUrl = this.configuredBaseUrl();
    if (!baseUrl) return [];

    try {
      return await fetchPhotonSuggestions(baseUrl, query, AddressAutocompleteService.MAX_RESULTS);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Address autocomplete request to ${baseUrl} failed: ${message}`);
      return [];
    }
  }
}
