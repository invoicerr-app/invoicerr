import { Navigate, Outlet, useLocation } from "react-router"
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"

import { BillingBanner } from "@/components/billing-banner"
import { OnboardingDialogHost, OnboardingDialogProvider } from "@/components/onboarding"
import { PageHeaderProvider, usePageHeaderContext } from "@/components/page-header-provider"
import { PwaInstallPrompt } from "@/components/pwa-install-prompt"
import { Sidebar } from "@/components/sidebar"
import { useDocumentEventsSse } from "@/hooks/use-document-events-sse"
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

  return <AuthenticatedLayout />
}

export default Layout
