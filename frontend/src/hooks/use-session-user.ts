import { authClient } from "@/lib/auth"

interface SessionUser {
  firstname?: string
  lastname?: string
  email?: string
}

/**
 * The signed-in user's profile fields, for the `/account` screens. additionalFields (firstname/
 * lastname) aren't reflected in the client's session type - `use-companies.ts` widens the same way
 * for the same reason.
 */
export function useSessionUser() {
  const { data: session, isPending, refetch } = authClient.useSession()
  const user = (session as unknown as { user?: SessionUser } | null)?.user
  return { user, isPending, refetch }
}
