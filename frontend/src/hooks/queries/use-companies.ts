import type { CompanyMembership, CompanyRole } from "@/types"
import { authClient } from "@/lib/auth"

interface SessionWithCompanies {
  companies?: CompanyMembership[]
  activeCompanyId?: string | null
  activeRole?: CompanyRole | null
}

// The backend's customSession plugin (see backend/src/lib/auth.ts) enriches
// every session payload with the caller's company memberships — this rides
// along on the same authClient.useSession() call already used elsewhere, no
// extra request needed.
export function useCompanies() {
  const session = authClient.useSession()
  // @ts-expect-error — additionalFields aren't reflected in the client's session type
  const data = session.data as SessionWithCompanies | null | undefined

  return {
    companies: data?.companies ?? [],
    activeCompanyId: data?.activeCompanyId ?? null,
    activeRole: data?.activeRole ?? null,
    isPending: session.isPending,
    refetch: session.refetch,
  }
}
