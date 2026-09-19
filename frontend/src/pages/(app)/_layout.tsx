import { TriangleAlert } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Navigate, Outlet, useLocation } from "react-router"
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"

import { BillingBanner } from "@/components/billing-banner"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { OnboardingDialogHost, OnboardingDialogProvider } from "@/components/onboarding"
import { PageHeaderProvider, usePageHeaderContext } from "@/components/page-header-provider"
import { PwaInstallPrompt } from "@/components/pwa-install-prompt"
import { Sidebar } from "@/components/sidebar"
import { WaitingForSeatScreen } from "@/components/waiting-for-seat-screen"
import { useDocumentEventsSse } from "@/hooks/use-document-events-sse"
import { useApplyAccountLocale } from "@/hooks/use-apply-account-locale"
import { ApiError } from "@/hooks/use-api-query"
import { useLegalStatus, useSeats } from "@/hooks/queries"
import { authClient } from "@/lib/auth"

const ALLOWED_PATHS = ["/signature/[^/]+"]

const PageHeaderTitle = () => {
  const { title } = usePageHeaderContext()

  if (!title) return null

  return (
    <div className="flex items-center gap-2">
      <h1 className="text-lg font-semibold text-foreground">{title}</h1>
    </div>
  )
}

const PageHeaderActions = () => {
  const { actions } = usePageHeaderContext()

  if (!actions) return null

  return <div className="flex items-center gap-2 ml-auto">{actions}</div>
}

/**
 * Rendered in place of the whole app shell when the no-free-seat gate's own query (`useSeats` below)
 * settles into a genuine error (a transient 500, a network drop) rather than the 404 that means "no
 * billing here at all". Blocking on `null` forever with nothing on screen left a member with no way
 * to tell "still loading" from "broken", and no recourse short of a manual page reload — this gives
 * them the same "what happened, try again" shape every other failed fetch in the app already gets.
 */
const SeatCheckErrorScreen = ({ onRetry }: { onRetry: () => void }) => {
  const { t } = useTranslation()

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6">
      <EmptyState
        icon={TriangleAlert}
        tone="destructive"
        title={t("seatGate.errorTitle")}
        description={t("seatGate.errorDescription")}
        action={
          <Button type="button" variant="outline" onClick={onRetry} data-cy="seat-check-error-retry">
            {t("common.emptyState.retry")}
          </Button>
        }
        data-cy="seat-check-error-screen"
      />
    </div>
  )
}

const AuthenticatedLayout = ({ accountLocale }: { accountLocale?: string | null }) => {
  // Mounted exactly ONCE, for the whole authenticated app: opens
  // the SSE connection (documents.controller.ts's `events` route) the moment a session exists, and
  // invalidates whichever document queries a status/conformity change concerns, regardless of which
  // screen the user currently has open. See that hook's own header for the full reasoning.
  useDocumentEventsSse()

  // The account's own language preference wins over whatever this browser had already guessed —
  // mounted here, once, so it applies to every authenticated screen regardless of which one this
  // session happens to land on first (`use-apply-account-locale.ts`'s own header for the full
  // reasoning; the Preferences screen also calls it directly, for the case where THAT screen is all
  // that's under test/rendered on its own).
  useApplyAccountLocale(accountLocale)

  return (
    <OnboardingDialogProvider>
      <SidebarProvider>
        <PageHeaderProvider>
          <section className="flex flex-col min-h-screen h-screen max-h-screen w-full max-w-screen overflow-y-auto overflow-x-hidden">
            <main className="flex flex-1 h-full w-full max-w-screen overflow-y-auto overflow-x-hidden">
              <Sidebar />
              <section className="flex flex-col flex-1 h-full w-full max-w-screen overflow-hidden">
                <BillingBanner />
                <header className="p-4 bg-header border-b flex items-center gap-4">
                  <SidebarTrigger />
                  <PageHeaderTitle />
                  <PageHeaderActions />
                </header>
                <section className="h-full overflow-y-auto overflow-x-hidden">
                  <Outlet />
                </section>
              </section>
            </main>
          </section>
        </PageHeaderProvider>
        {/* Fixed to the viewport bottom (see the component's own className) — mounted here, not
            inside any scrolling section, purely for readability; its positioning doesn't depend on
            where in the tree it sits. */}
        <PwaInstallPrompt />
        {/* A sibling of Sidebar, not a child of it — see useOnboardingDialog's own comment: Sidebar's
            root unmounts entirely while its mobile Sheet is closed, which used to make this dialog
            unreachable on mobile no matter how it was triggered. */}
        <OnboardingDialogHost />
      </SidebarProvider>
    </OnboardingDialogProvider>
  )
}

const UnauthenticatedLayout = () => {
  return (
    <PageHeaderProvider>
      <section className="flex flex-col min-h-screen h-screen max-h-screen w-full max-w-screen overflow-y-auto overflow-x-hidden">
        <main className="flex flex-1 h-full w-full max-w-screen overflow-y-auto overflow-x-hidden">
          <section className="flex flex-col flex-1 h-full w-full max-w-screen overflow-hidden">
            <header className="p-4 bg-header border-b flex items-center gap-4">
              <PageHeaderTitle />
              <PageHeaderActions />
            </header>
            <section className="h-full overflow-y-auto overflow-x-hidden">
              <Outlet />
            </section>
          </section>
        </main>
      </section>
    </PageHeaderProvider>
  )
}

const Layout = () => {
  const location = useLocation()
  const { data: session, isPending } = authClient.useSession()
  // `enabled: !!session` — no point asking before a session even exists, and this hook must never be
  // the thing that delays the sign-in redirect below. Always the empty/false shape outside SaaS mode
  // (`legal.service.ts#getStatus`), so this adds nothing to check for a self-hosted instance beyond
  // one extra cheap, always-200 request.
  const { data: legalStatus, isPending: legalStatusPending } = useLegalStatus(!!session)
  // Same reasoning as `legalStatus` above: gated on a session existing, harmless (a plain 404, `useSeats`'s
  // own `retry: false`) on a self-hosted instance where this route does not exist at all.
  const {
    data: seatsView,
    isPending: seatsPending,
    isError: seatsErrored,
    error: seatsError,
    refetch: refetchSeats,
  } = useSeats(!!session)

  // A public route stays outside the app shell UNCONDITIONALLY — a signed-in staff member opening
  // a client's own signature link must see the same bare, public page a client does, never the
  // sidebar/header chrome wrapped around someone else's document. Checked before EVERY
  // session-derived gate below, `isPending` included, not only the `!session` branch (which used to
  // gate this) — `useSession()` refetches on its own accord (better-auth revalidates on window
  // focus), so `isPending` flips back to true well after the initial load, and this path never reads
  // `session`/`legalStatus`/`seatsView` for anything. Gating on it anyway blanked (`return null`) —
  // and, on the very next render, REMOUNTED — a page that has no use for a session in the first
  // place: a signature link left mid-OTP-entry, tabbed away from and back to, lost its own step,
  // its typed code, everything, on every single such refetch.
  const isAllowedPath = ALLOWED_PATHS.some((path) => location.pathname.match(new RegExp(path)))
  if (isAllowedPath) {
    return <UnauthenticatedLayout />
  }

  if (isPending) {
    return null
  }

  if (!session) {
    return <Navigate to="/auth/sign-in" />
  }

  // Wait for the legal check before rendering ANYTHING authenticated — without this, a user due for
  // the re-acceptance interstitial would see a flash of the real sidebar/dashboard (and mount its own
  // SSE connection via `useDocumentEventsSse` below) for the one render before this query resolves.
  // `enabled: !!session` above means this reflects a genuine fetch now that we know a session exists,
  // never a permanently-disabled query's own `isPending: true`.
  if (legalStatusPending) {
    return null
  }

  // SaaS-mode re-acceptance interstitial (product decision 2026-09-16): a required legal document
  // (Terms of Service / Privacy Policy) has a newer version than what this user last accepted. Blocks
  // the WHOLE app shell — no sidebar, no `<Outlet/>` — rather than a dismissible banner the way
  // `BillingBanner` handles a trial/blocked subscription: unlike that read-only state, this is meant
  // to be a binary "not until you've reviewed the update" gate, so it redirects instead of rendering
  // alongside the app. `/legal/accept` is a top-level, non-`(app)` route (this file's own `Layout`
  // wraps ONLY `(app)/*` routes — see the module header), so it renders through none of this file's
  // chrome once reached; this redirect is what actually gets a visitor there. Always `false` outside
  // SaaS mode, so this never fires on a self-hosted instance.
  if (legalStatus?.requiresAcceptance) {
    return <Navigate to="/legal/accept" replace />
  }

  // No-free-seat gate (an over-capacity company — the OWNER lowered the bought quantity below the
  // current headcount): blocks the whole app shell exactly like the legal interstitial above, but
  // renders in place rather than navigating — there is no separate route for it, just a full-screen
  // component. `seatsView` stays `undefined` on a self-hosted instance (the route genuinely 404s —
  // this app never bundles billing there) or before the fetch resolves.
  //
  // Wait for THIS query too, exactly like `legalStatusPending` above — the check below reads
  // `seatsView`, so rendering `AuthenticatedLayout` (sidebar, `<Outlet/>`, its own SSE connection)
  // while the request is still in flight was a real flash of the full app shell for an over-capacity
  // member, not merely a theoretical one. And a 404 is the ONLY error this route is allowed to mean
  // "no gate applies" for (self-hosted, billing not mounted at all) — `useSeats`'s own `retry: false`
  // means a genuine failure (a transient 500, a network drop) settles into `isError` just as fast,
  // and treating THAT the same as "no seats data, so nothing to wait for" would silently wave an
  // over-capacity member through on nothing more than a blip. Blocking here has no write-side stakes
  // either way (`billing/seat-gate.ts` enforces the real limit server-side, unconditionally) — this
  // is purely about not showing the product screen to someone the product itself would still refuse.
  //
  // A genuine (settled) error gets its own visible retry screen below rather than joining the
  // `null` branch: `null` is fine for the brief in-flight window (nothing to show yet), but an ERROR
  // is not "still loading" — rendering nothing forever left a member unable to tell the two apart,
  // with no way to recover short of a manual page reload.
  const seatsRouteMissing = seatsErrored && seatsError instanceof ApiError && seatsError.status === 404
  if (seatsPending) {
    return null
  }
  if (seatsErrored && !seatsRouteMissing) {
    return <SeatCheckErrorScreen onRetry={() => refetchSeats()} />
  }

  const currentUserId = (session as { user?: { id?: string } } | null)?.user?.id
  const isWaitingForSeat =
    !!currentUserId && !!seatsView?.waiting.some((member) => member.userId === currentUserId)
  if (isWaitingForSeat) {
    const owner = seatsView?.members.find((member) => member.role === "OWNER")
    return <WaitingForSeatScreen ownerName={owner ? `${owner.firstname} ${owner.lastname}` : null} />
  }

  const accountLocale = (session as { user?: { locale?: string | null } } | null)?.user?.locale
  return <AuthenticatedLayout accountLocale={accountLocale} />
}

export default Layout
