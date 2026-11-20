import { useNavigate } from "react-router"

import { signOut } from "@/lib/sign-out"

/** An explicit sign-out (see `lib/sign-out.ts`), then the sign-in page. */
export function useSignOutAndRedirect(): () => Promise<void> {
  const navigate = useNavigate()
  return async () => {
    await signOut()
    void navigate("/auth/sign-in")
  }
}
