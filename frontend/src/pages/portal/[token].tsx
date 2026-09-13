import { useEffect } from "react"
import { useNavigate, useParams } from "react-router"

import { setPortalToken } from "@/hooks/use-portal-fetch"

/**
 * The client portal's OWN bootstrap route — the ONLY place the raw, emailed token ever appears in the
 * URL. Captures it into `localStorage` (`use-portal-fetch.ts`) once, then redirects to the clean
 * `/portal` URL: every later visit/reload reads the stored token instead, and the sensitive value
 * never lingers in the address bar, browser history entry list, or a `Referer` header a later
 * navigation from this page might otherwise leak it through.
 *
 * Store-then-navigate happens in ONE effect, imperatively (`useNavigate`, never a declarative
 * `<Navigate>` sibling): React fires a CHILD's own effects before its parent's, so a `<Navigate>`
 * rendered here as JSX could fire its own redirect before this component's `useEffect` ever ran,
 * racing the very write it depends on. This ordering is deliberate, not incidental.
 *
 * A TOP-LEVEL page (`pages/portal/`, no `(app)` group) — NOT nested under `(app)/_layout.tsx`, the
 * same reason `pages/auth/*.tsx` sit outside that group: this whole area has no business depending on
 * `authClient.useSession()` (a STAFF concept) at all, and must render identically whether or not a
 * staff member happens to be signed in on the same browser.
 */
export default function PortalTokenBootstrap() {
  const { token } = useParams()
  const navigate = useNavigate()

  useEffect(() => {
    if (token) setPortalToken(token)
    navigate("/portal", { replace: true })
  }, [token, navigate])

  return null
}
