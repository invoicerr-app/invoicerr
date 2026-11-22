import { AlertTriangle, Shield, SlidersHorizontal, User } from "lucide-react"
import { Outlet, useLocation, useNavigate } from "react-router"

import { Avatar, AvatarFallback, getInitials } from "@/components/ui/avatar"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { usePageHeader } from "@/hooks/use-page-header"
import { useSessionUser } from "@/hooks/use-session-user"
import { useTranslation } from "react-i18next"

const NAV_ITEMS = [
  { path: "/account", labelKey: "account.nav.profile", icon: User },
  { path: "/account/security", labelKey: "account.nav.security", icon: Shield },
  { path: "/account/preferences", labelKey: "account.nav.preferences", icon: SlidersHorizontal },
  { path: "/account/danger", labelKey: "account.nav.danger", icon: AlertTriangle },
] as const

/**
 * Shell for the four `/account/*` routes (option B from the product decision: a personal-account
 * area OUTSIDE the company `Settings` screen, reached from the avatar menu — see
 * `components/sidebar.tsx`'s "My account" item). Owns the profile header (avatar + name + email)
 * and the sub-nav; each route below renders its own content through `<Outlet/>`.
 *
 * Tabs are driven by the URL (`value`/`onValueChange`, not Radix's own uncontrolled state) so the
 * active tab survives a refresh or a direct link to e.g. `/account/danger` — reusing the shared
 * `Tabs` primitive (rather than a bespoke nav) keeps the concentric radius, motion and hover
 * language identical to every other tab strip in the app.
 */
export default function AccountLayout() {
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const { user, isPending } = useSessionUser()

  usePageHeader(t("account.pageTitle"))

  const initials = getInitials(user?.firstname, user?.lastname, user?.email)
  const displayName = [user?.firstname, user?.lastname].filter(Boolean).join(" ")

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <div className="mb-8 flex items-center gap-4">
        <Avatar className="size-14">
          <AvatarFallback className="text-lg">{initials}</AvatarFallback>
        </Avatar>
        {isPending ? (
          <div className="grid gap-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-56" />
          </div>
        ) : (
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold">{displayName || user?.email}</h1>
            <p className="truncate text-sm text-muted-foreground">{user?.email}</p>
          </div>
        )}
      </div>

      <Tabs value={location.pathname} onValueChange={(path) => navigate(path)} className="gap-6">
        <TabsList className="h-10 w-full justify-start overflow-x-auto sm:w-fit">
          {NAV_ITEMS.map((item) => (
            <TabsTrigger
              key={item.path}
              value={item.path}
              data-cy={`account-nav-${item.path === "/account" ? "profile" : item.path.split("/").pop()}`}
              className={
                item.path === "/account/danger"
                  ? "data-[state=active]:text-destructive text-destructive/80"
                  : undefined
              }
            >
              <item.icon className="size-4" />
              {t(item.labelKey)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="mt-6">
        <Outlet />
      </div>
    </div>
  )
}
