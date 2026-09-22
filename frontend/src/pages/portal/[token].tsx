import { useEffect } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router"

import { setPortalToken } from "@/hooks/use-portal-fetch"

/**
 * The client portal's OWN bootstrap route — the ONLY place the raw, emailed token ever appears in the
 * URL. Captures it into `localStorage` (`use-portal-fetch.ts`) once, then redirects to the clean
 * `/portal` URL: every later visit/reload reads the stored token instead, and the sensitive value
 * never lingers in the address bar, browser history entry list, or a `Referer` header a later
 * navigation from this page might otherwise leak it through.
 *
 * A payment provider's `successUrl`/`cancelUrl` deliberately do NOT land here — they point at the
 * bare `/portal`, because a return URL is stored by the provider and a token in it would reach that
 * provider's dashboard and logs (see `PortalService.createInvoiceCheckoutSession`'s own header). The
 * tab returning from checkout reads the token `localStorage` already holds: storage is per-ORIGIN,
 * shared by every tab of the same browser profile, so a new tab is not a fresh, empty one here.
 *
 * The whole search string is nonetheless forwarded onto the clean `/portal` URL below rather than
 * dropped (not just the keys this file happens to know): query params added to the emailed link —
 * and the `?payment=success|cancelled` flag `pages/portal/index.tsx`'s own return-banner effect
 * reads, should a link ever arrive carrying one — survive this hop without this file needing to know
 * their names.
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
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  useEffect(() => {
    if (token) setPortalToken(token)
    const search = searchParams.toString()
    navigate({ pathname: "/portal", search: search ? `?${search}` : "" }, { replace: true })
    // biome-ignore lint/correctness/useExhaustiveDependencies: run once on mount, against whatever
    // search string this page itself landed with — never re-armed by searchParams changing identity.
  }, [token, navigate])

  return null
}
