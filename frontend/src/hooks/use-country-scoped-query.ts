import { useApiQuery } from "./use-api-query"

/**
 * A read keyed by one country, disabled until there is a country (and the caller's own `enabled`
 * gate holds). `buildUrl` receives the country code already URI-encoded. The query key stays the
 * caller's own, so each hook keeps its exact cache entry.
 */
export function useCountryScopedQuery<T>(
  key: readonly unknown[],
  countryCode: string | undefined | null,
  buildUrl: (encodedCountryCode: string) => string,
  enabled = true,
) {
  const url = enabled && countryCode ? buildUrl(encodeURIComponent(countryCode)) : null
  return useApiQuery<T>(key, url!, { enabled: !!url })
}
