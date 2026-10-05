import { useReferenceSearch } from "@/hooks/queries"
import { useDebouncedValue } from "@/hooks/use-debounced-value"

const DEBOUNCE_MS = 300

/**
 * Debounced reference-search suggestions for `query`. Nothing is fetched while `enabled` is false or
 * the trimmed query is empty, and results are withheld until the debounce has caught up with what is
 * typed so a stale list never sits under a newer query.
 */
export function useCatalogSearch(entity: string, query: string, enabled: boolean) {
  const trimmed = query.trim()
  const debounced = useDebouncedValue(trimmed, DEBOUNCE_MS)
  const shouldSearch = enabled && debounced !== ""
  const { data } = useReferenceSearch(shouldSearch ? entity : undefined, debounced)

  return { options: shouldSearch && debounced === trimmed ? (data ?? []) : [] }
}
