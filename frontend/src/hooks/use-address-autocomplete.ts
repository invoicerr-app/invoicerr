import { useApiQuery } from "@/hooks/use-api-query"
import { useDebouncedValue } from "@/hooks/use-debounced-value"

/**
 * Address autocomplete (#197) - suggestions proxied through this backend's own
 * `/api/address-autocomplete/*` (never a third party called directly from the browser, see
 * `address-autocomplete.service.ts`'s own header on the backend).
 */

export interface AddressSuggestion {
  /** Full display line for the dropdown, e.g. "12 Rue de la Paix, 75002 Paris, France". */
  label: string
  street?: string
  houseNumber?: string
  postalCode?: string
  city?: string
  /** Country name in Photon's own language - informational only, never shown directly. */
  country?: string
  /** ISO 3166-1 alpha-2, uppercase. */
  countryCode?: string
}

interface AddressAutocompleteCapability {
  enabled: boolean
}

const MIN_QUERY_LENGTH = 3
const DEBOUNCE_MS = 300

/**
 * Whether THIS instance has `ADDRESS_AUTOCOMPLETE_URL` configured. Checked once per session
 * (`staleTime: Infinity` - an operator changing this env var means a redeploy, never something that
 * happens while a tab stays open) so every address field on the page shares one cached answer
 * instead of each firing its own capability request. `enabled: false` (the self-hosted default) is
 * what lets `useAddressAutocomplete` below skip the search query entirely - the empty-setting case
 * makes ZERO network calls, never a search that just comes back with nothing.
 */
export function useAddressAutocompleteCapability() {
  return useApiQuery<AddressAutocompleteCapability>(
    ["address-autocomplete-capability"],
    "/api/address-autocomplete/capability",
    { staleTime: Number.POSITIVE_INFINITY, gcTime: Number.POSITIVE_INFINITY, retry: false },
  )
}

/**
 * Debounced (~300ms) suggestions for `query`, from 3 characters, never fetched while `enabled` is
 * false. Backed by `useApiQuery` (TanStack Query), so results are cached per query string for the
 * rest of the browser session - retyping something already searched costs no extra request.
 *
 * Never throws into the caller and never blocks typing: a network failure, a timeout, or the
 * configured Photon server being down all resolve server-side to an empty `suggestions` array (see
 * the backend service's own header) - this hook only ever adds an optional dropdown on top of a
 * plain, always-working text field.
 */
export function useAddressAutocomplete(query: string, enabled: boolean) {
  const debounced = useDebouncedValue(query, DEBOUNCE_MS)
  const trimmed = debounced.trim()
  const shouldSearch = enabled && trimmed.length >= MIN_QUERY_LENGTH

  const { data, isFetching } = useApiQuery<{ suggestions: AddressSuggestion[] }>(
    ["address-autocomplete-search", trimmed],
    `/api/address-autocomplete/search?q=${encodeURIComponent(trimmed)}`,
    { enabled: shouldSearch, staleTime: 5 * 60 * 1000, retry: false },
  )

  return {
    suggestions: shouldSearch ? (data?.suggestions ?? []) : [],
    isFetching: shouldSearch && isFetching,
  }
}
