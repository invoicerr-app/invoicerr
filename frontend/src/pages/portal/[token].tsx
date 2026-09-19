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
 * This is ALSO where a payment provider's `successUrl`/`cancelUrl` land (see
 * `PortalService.createInvoiceCheckoutSession`'s own header — the checkout opens in a NEW tab, so it
 * cannot rely on `localStorage` already holding a token the way a same-tab reload can): those URLs
 * carry a `?payment=success|cancelled` flag that `pages/portal/index.tsx`'s own return-banner effect
 * reads to pick a toast. That flag is therefore forwarded onto the clean `/portal` URL below (the
 * WHOLE search string, not just this one known key — future query params added to either the emailed
 * link or a payment redirect survive this hop without this file needing to know their names) rather
 * than dropped: dropping it here would silently swallow the payment return signal on its very first
 * hop, before `index.tsx` ever gets a chance to read it.
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
