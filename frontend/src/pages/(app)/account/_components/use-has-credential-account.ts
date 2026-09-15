import { type Dispatch, type SetStateAction, useEffect, useState } from "react"

import { authClient } from "@/lib/auth"

/**
 * Whether the current user has a credential (email/password) account, or `null` while that is
 * still loading. Shared between `security.tsx` (which password flow applies — `changePassword` vs.
 * the OIDC-only `set-password` route) and `danger.tsx` (password confirmation vs. email
 * confirmation for account deletion) so visiting either of `/account`'s two most sensitive tabs
 * makes exactly one `listAccounts` call, not a copy of the same effect in each file.
 *
 * Exposes the setter too: `security.tsx` flips it to `true` right after `set-password` succeeds, so
 * a user who just created their first password doesn't have to leave and come back to `/account` for
 * the rest of the session to know it.
 */
export function useHasCredentialAccount(): [boolean | null, Dispatch<SetStateAction<boolean | null>>] {
  const [hasCredentialAccount, setHasCredentialAccount] = useState<boolean | null>(null)

  useEffect(() => {
    authClient
      .listAccounts()
      .then(({ data }) => {
        setHasCredentialAccount(data?.some((account) => account.providerId === "credential") ?? false)
      })
      .catch(() => setHasCredentialAccount(false))
  }, [])

  return [hasCredentialAccount, setHasCredentialAccount]
}
