import { Navigate, Outlet, useLocation } from "react-router"
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"

import { BillingBanner } from "@/components/billing-banner"
import { OnboardingDialogHost, OnboardingDialogProvider } from "@/components/onboarding"
import { PageHeaderProvider, usePageHeaderContext } from "@/components/page-header-provider"
import { PwaInstallPrompt } from "@/components/pwa-install-prompt"
import { Sidebar } from "@/components/sidebar"
import { useDocumentEventsSse } from "@/hooks/use-document-events-sse"
import { useLegalStatus } from "@/hooks/queries"
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

const AuthenticatedLayout = () => {
  // Mounted exactly ONCE, for the whole authenticated app: opens
  // the SSE connection (documents.controller.ts's `events` route) the moment a session exists, and
  // invalidates whichever document queries a status/conformity change concerns, regardless of which
  // screen the user currently has open. See that hook's own header for the full reasoning.
  useDocumentEventsSse()

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

  if (isPending) {
    return null
  }

  // A public route stays outside the app shell UNCONDITIONALLY — a signed-in staff member opening
  // a client's own signature link must see the same bare, public page a client does, never the
  // sidebar/header chrome wrapped around someone else's document. Checked before the session
  // branch below (which used to gate this), not after: that order let a logged-in visit fall
  // through to AuthenticatedLayout regardless of path.
  const isAllowedPath = ALLOWED_PATHS.some((path) => location.pathname.match(new RegExp(path)))
  if (isAllowedPath) {
    return <UnauthenticatedLayout />
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

  return <AuthenticatedLayout />
}

export default Layout
