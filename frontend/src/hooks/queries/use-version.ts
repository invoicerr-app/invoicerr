import { useApiQuery } from "@/hooks/use-api-query"
import { queryKeys } from "@/lib/query-keys"

export interface VersionInfo {
  currentVersion: string
  latestVersion: string | null
  latestUrl: string | null
  updateAvailable: boolean
  checkedAt: string | null
}

/**
 * `GET /api/version` — issue #371. The backend itself already caches this for hours and never
 * throws (see `backend/src/modules/version/version.service.ts`'s own header), so this hook keeps a
 * long `staleTime` too: there is no reason for every tab switch (the query client's own
 * `refetchOnWindowFocus: true` default) to re-hit even our own backend for something that changes at
 * most a few times a year.
 */
export function useVersionInfo() {
  return useApiQuery<VersionInfo>(queryKeys.version.info(), "/api/version", {
    staleTime: 60 * 60_000, // 1h
  })
}
