import { authClient } from "@/lib/auth"

const SIGNED_OUT_KEY = "invoicerr.signedOut"

/** Every explicit sign-out goes through here, so the demo's automatic sign-in does not undo it. */
export async function signOut() {
  try {
    sessionStorage.setItem(SIGNED_OUT_KEY, "true")
  } catch {
    // Unreadable storage already reads as signed out below.
  }
  await authClient.signOut()
}

/** True when this tab signed out explicitly, and when storage cannot tell: never sign anyone back in by guess. */
export function hasSignedOutInThisTab(): boolean {
  try {
    return sessionStorage.getItem(SIGNED_OUT_KEY) !== null
  } catch {
    return true
  }
}
