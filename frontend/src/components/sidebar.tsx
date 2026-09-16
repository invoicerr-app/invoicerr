import {
  Building2,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Clock,
  CreditCard,
  FileStack,
  FileText,
  Gavel,
  Landmark,
  LayoutDashboard,
  LogOut,
  Package,
  Plus,
  Settings,
  TrendingUp,
  User,
  Users,
} from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { DropdownMenuGroup, DropdownMenuLabel, DropdownMenuSeparator } from "@radix-ui/react-dropdown-menu"
import { Link, useLocation, useNavigate } from "react-router"
import {
  Sidebar as RootSidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar"

import { Badge } from "./ui/badge"
import { BrandMark } from "./brand-mark"
import { useOnboardingDialog } from "./onboarding"
import type React from "react"
import { Skeleton } from "./ui/skeleton"
import { authClient } from "@/lib/auth"
import { useEffect, useRef, useState } from "react"
import { usePost } from "@/hooks/use-fetch"

import { useAvailableDocumentTypes, useCompanies, useCompany } from "@/hooks/queries"
import { useIsMobile } from "@/hooks/use-mobile"
import { useTranslation } from "react-i18next"

export function Sidebar() {
  const { t } = useTranslation()
  const isMobile = useIsMobile()
  const location = useLocation()

  const { data, isPending: userLoading } = authClient.useSession()
  const { companies, activeCompanyId, isPending: companiesLoading } = useCompanies()

  const { data: company } = useCompany()
  const navigate = useNavigate()

  const { setOpen: setOnboardingOpen } = useOnboardingDialog()
  const hasAutoOpenedOnboarding = useRef(false)

  const { trigger: switchCompanyApi } = usePost<{ success: boolean }>("/api/companies/switch")

  useEffect(() => {
    if (
      !hasAutoOpenedOnboarding.current &&
      !companiesLoading &&
      companies.length === 0 &&
      location.pathname !== "/settings/company"
    ) {
      hasAutoOpenedOnboarding.current = true
      setOnboardingOpen(true)
    }
  }, [companiesLoading, companies, location.pathname, setOnboardingOpen])

  const switchCompany = async (companyId: string) => {
    if (companyId === activeCompanyId) return
    await switchCompanyApi({ companyId })
    // Full reload: company-scoped data is fetched by two different
    // mechanisms across the app (TanStack Query hooks and the older
    // useGet/usePost hooks in use-fetch.ts, e.g. every settings page).
    // invalidateQueries() only refreshes the former, leaving the latter
    // showing the previous company's data — a reload guarantees every
    // page re-fetches under the newly active company.
    window.location.reload()
  }

  // The static part of the nav — Dashboard, Statistics, Settings never depend on anything: they
  // exist regardless of what the active company's country allows. "Documents" is deliberately NOT
  // in this list: it is rendered separately below, populated from useAvailableDocumentTypes() rather
  // than a fixed url, since which document types even exist is per-country data, not a constant.
  //
  // Payment Methods, Received Invoices, Compliance, Quotes, Invoices, and Payments used to be here —
  // all removed along with the screens they pointed to (see git history's
  // "suppression des documents légaux et du moteur de conformité"). A link to a page that no longer
  // exists is worse than no link at all, so none of them were kept as placeholders.
  const items: { title: string; icon: React.ReactNode; url: string; dataCy: string }[] = [
    {
      title: t("sidebar.navigation.dashboard"),
      icon: <LayoutDashboard className="w-4 h-4" />,
      url: "/dashboard",
      dataCy: "sidebar-dashboard-link",
    },
  ]

  const dataItems: { title: string; icon: React.ReactNode; url: string; dataCy: string }[] = [
    {
      title: t("sidebar.navigation.clients"),
      icon: <Users className="w-4 h-4" />,
      url: "/clients",
      dataCy: "sidebar-clients-link",
    },
    {
      title: t("sidebar.navigation.articles"),
      icon: <Package className="w-4 h-4" />,
      url: "/articles",
      dataCy: "sidebar-articles-link",
    },
    {
      title: t("sidebar.navigation.timeTracking"),
      icon: <Clock className="w-4 h-4" />,
      url: "/time-tracking",
      dataCy: "sidebar-time-tracking-link",
    },
    {
      title: t("sidebar.navigation.bankReconciliation"),
      icon: <Landmark className="w-4 h-4" />,
      url: "/bank-reconciliation",
      dataCy: "sidebar-bank-reconciliation-link",
    },
    {
      title: t("sidebar.navigation.paymentMethods"),
      icon: <CreditCard className="w-4 h-4" />,
      url: "/payment-methods",
      dataCy: "sidebar-payment-methods-link",
    },
    {
      title: t("sidebar.navigation.declarations"),
      icon: <Gavel className="w-4 h-4" />,
      url: "/declarations",
      dataCy: "sidebar-declarations-link",
    },
  ]

  const trailingItems: { title: string; icon: React.ReactNode; url: string; dataCy: string }[] = [
    {
      title: t("sidebar.navigation.stats"),
      icon: <TrendingUp className="w-4 h-4" />,
      url: "/statistics",
      dataCy: "sidebar-statistics-link",
    },
    {
      title: t("sidebar.navigation.settings"),
      icon: <Settings className="w-4 h-4" />,
      url: "/settings",
      dataCy: "sidebar-settings-link",
    },
  ]

  // The Documents group's own content — the ONLY place in the sidebar that reads what the active
  // company's COUNTRY makes available (see country-policy/country-policy.ts's
  // resolveAvailableDocumentTypes on the backend). Open by default: a company almost always has at
  // least one type available (a bare/unresolved country is the exception, not the rule), so starting
  // collapsed would hide the normal case behind an extra click.
  const [documentsOpen, setDocumentsOpen] = useState(true)
  const { data: availableTypes, isLoading: typesLoading } = useAvailableDocumentTypes()

  // The "Data" group: collapsible on the exact same mechanic as Documents right above (a toggle
  // SidebarMenuButton + SidebarMenuSub, no persistence beyond this session) — see dataItems' own
  // definition above and this group's own JSX comment for why it stopped being a fixed, un-collapsible
  // pair once Time tracking/Bank reconciliation/Payment methods joined Clients/Articles here. Open by
  // default for the same reason Documents already is: every one of these screens is something most
  // companies actually use, so starting collapsed would hide the normal case behind an extra click.
  const [dataOpen, setDataOpen] = useState(true)

  const handleLogout = async () => {
    await authClient.signOut()
    navigate("/auth/sign-in")
  }

  return (
    <RootSidebar collapsible="icon">
      {/* The dialog itself no longer mounts here — see useOnboardingDialog's own comment on why: on
          mobile this whole subtree is unmounted (not just hidden) while the Sheet is closed, which
          silently prevented the dialog from ever opening. It is rendered once, at the layout level,
          alongside this same shared open state. */}
      <SidebarHeader className="px-2">
        {/* The product's own identity, above the company switcher — that dropdown is the ACTIVE
            COMPANY, not the app, and conflating the two would leave no header that just says
            "this is Invoicerr". The wordmark hides itself in icon-collapsed mode the same way every
            other label in this sidebar does (`group-data-[collapsible=icon]:hidden`); the mark
            alone stays, exactly like every other icon-only row when the sidebar is collapsed. */}
        <div className="flex items-center gap-2 px-2 pt-1 pb-2">
          <BrandMark className="size-5 text-sidebar-foreground" />
          <span className="font-heading text-sm font-semibold tracking-tight text-sidebar-foreground group-data-[collapsible=icon]:hidden">
            Invoicerr
          </span>
        </div>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger className="cursor-pointer" asChild>
                <SidebarMenuButton
                  size="lg"
                  className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                  data-cy="sidebar-company-button"
                >
                  <div className="bg-accent text-accent-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                    <Building2 className="size-4" />
                  </div>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{company?.name}</span>
                    <span className="truncate text-xs">{t("sidebar.company.plan")}</span>
                  </div>
                  {companies.length > 1 && <ChevronsUpDown className="ml-auto size-4" />}
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
                align="start"
                side={isMobile ? "bottom" : "right"}
              >
                <DropdownMenuLabel className="text-xs text-muted-foreground px-2 py-1.5">
                  {t("sidebar.company.switcherLabel")}
                </DropdownMenuLabel>
                <DropdownMenuGroup>
                  {companies.map((c) => (
                    <DropdownMenuItem
                      key={c.id}
                      className="cursor-pointer flex items-center gap-2"
                      data-cy="sidebar-company-switch-item"
                      onClick={() => switchCompany(c.id)}
                    >
                      {c.id === activeCompanyId ? (
                        <Check className="size-4 shrink-0" />
                      ) : (
                        <span className="size-4 shrink-0" />
                      )}
                      <span className="flex-1 truncate">{c.name}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {c.role}
                      </Badge>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="cursor-pointer"
                  data-cy="sidebar-create-company-item"
                  onSelect={(e) => {
                    // Opening a Dialog directly from a DropdownMenuItem's own
                    // click races the menu's close/focus-return against the
                    // dialog's open/autofocus — the dialog can steal focus back
                    // from its own input mid-transition, dropping the first
                    // keystroke typed into it. Deferring to the next tick lets
                    // the dropdown finish closing first.
                    e.preventDefault()
                    setTimeout(() => setOnboardingOpen(true), 0)
                  }}
                >
                  <Plus className="size-4" />
                  {t("sidebar.company.createNew")}
                </DropdownMenuItem>
                <DropdownMenuItem className="cursor-pointer" onClick={() => navigate("/settings/company")}>
                  <Settings className="size-4" />
                  {t("sidebar.company.manage")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent className="px-2">
        <SidebarGroup className="px-0">
          <SidebarGroupLabel>{t("sidebar.menu")}</SidebarGroupLabel>
          <SidebarMenu>
            {items.map((item) => (
              <SidebarMenuItem key={item.url}>
                <SidebarMenuButton asChild>
                  <Link
                    data-cy={item.dataCy}
                    to={item.url}
                    className={`flex items-center gap-2 py-6 ${
                      location.pathname.startsWith(item.url)
                        ? "text-sidebar-accent-foreground bg-sidebar-accent"
                        : ""
                    }`}
                  >
                    {item.icon}
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}

            {/* The Documents group: collapsible, and populated from whatever the active company's
                country makes available — never a fixed list of urls. See useAvailableDocumentTypes'
                own comment for the distinction from useDocumentTypesList (every registered type,
                unfiltered), which this sidebar deliberately does NOT use. */}
            <SidebarMenuItem>
              <SidebarMenuButton
                className="flex items-center gap-2 py-6"
                onClick={() => setDocumentsOpen((open) => !open)}
                data-cy="sidebar-documents-group-toggle"
              >
                <FileStack className="w-4 h-4" />
                <span className="flex-1">{t("sidebar.navigation.documents")}</span>
                {documentsOpen ? (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                )}
              </SidebarMenuButton>
            </SidebarMenuItem>

            {documentsOpen && (
              <SidebarMenuSub>
                {typesLoading && (
                  <SidebarMenuSubItem>
                    <Skeleton className="h-6 w-full" />
                  </SidebarMenuSubItem>
                )}

                {/* A country with no policy at all (or that can't be resolved) has NO document
                    types — this SAYS so plainly, with the backend's own reason, rather than leaving the
                    group silently empty (which would look like a loading bug, not a real state). */}
                {!typesLoading && (availableTypes?.types.length ?? 0) === 0 && (
                  <SidebarMenuSubItem>
                    <p
                      className="whitespace-normal px-2 py-1.5 text-xs text-muted-foreground"
                      data-cy="sidebar-documents-empty"
                    >
                      {availableTypes?.reason ?? t("sidebar.documents.empty")}
                    </p>
                  </SidebarMenuSubItem>
                )}

                {availableTypes?.types.map((type) => (
                  <SidebarMenuSubItem key={type.id}>
                    <SidebarMenuSubButton asChild isActive={location.pathname === `/documents/${type.id}`}>
                      <Link data-cy={`sidebar-document-type-link-${type.id}`} to={`/documents/${type.id}`}>
                        <FileText className="h-4 w-4" />
                        <span>{type.label}</span>
                      </Link>
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                ))}
              </SidebarMenuSub>
            )}
          </SidebarMenu>
        </SidebarGroup>

        {/* "Data" — a collapsible group, on the exact same mechanic as "Documents" right above
            (a toggle SidebarMenuButton + SidebarMenuSub, open by default, no cross-session
            persistence). It USED TO be a fixed, un-collapsible pair (Clients, Articles) — that
            stopped being true the moment Time tracking and Bank reconciliation joined it, and is
            even less true now that Payment methods has too: this is simply every per-company
            OPERATIONAL RECORD screen that isn't itself a DocumentTypeDescriptor (which is what the
            Documents group above already covers, country by country) — a growing list, not a fixed
            pair, hence the same collapse affordance Documents already needed for the same reason. */}
        <SidebarGroup className="px-0">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                className="flex items-center gap-2 py-6"
                onClick={() => setDataOpen((open) => !open)}
                data-cy="sidebar-data-group-toggle"
              >
                <Users className="w-4 h-4" />
                <span className="flex-1">{t("sidebar.groups.data")}</span>
                {dataOpen ? (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                )}
              </SidebarMenuButton>
            </SidebarMenuItem>

            {dataOpen && (
              <SidebarMenuSub>
                {dataItems.map((item) => (
                  <SidebarMenuSubItem key={item.url}>
                    <SidebarMenuSubButton asChild isActive={location.pathname.startsWith(item.url)}>
                      <Link data-cy={item.dataCy} to={item.url}>
                        {item.icon}
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                ))}
              </SidebarMenuSub>
            )}
          </SidebarMenu>
        </SidebarGroup>

        <SidebarGroup className="px-0">
          <SidebarMenu>
            {trailingItems.map((item) => (
              <SidebarMenuItem key={item.url}>
                <SidebarMenuButton asChild>
                  <Link
                    data-cy={item.dataCy}
                    to={item.url}
                    className={`flex items-center gap-2 py-6 ${
                      location.pathname.startsWith(item.url)
                        ? "text-sidebar-accent-foreground bg-sidebar-accent"
                        : ""
                    }`}
                  >
                    {item.icon}
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu className="flex flex-col gap-2">
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger className="cursor-pointer" asChild>
                <SidebarMenuButton
                  size="lg"
                  data-cy="sidebar-user-menu-trigger"
                  className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                >
                  <div className="bg-accent text-accent-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                    <User className="size-4" />
                  </div>
                  {userLoading ? (
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <Skeleton className="h-3 w-3/4" />
                      <Skeleton className="h-2 w-1/2 mt-1" />
                    </div>
                  ) : (
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <span className="truncate font-medium">
                        {/* @ts-ignore */}
                        {[data?.user?.firstname, data?.user?.lastname].filter(Boolean).join(" ")}
                      </span>
                      <span className="truncate text-xs">{data?.user?.email}</span>
                    </div>
                  )}
                  <ChevronsUpDown className="ml-auto size-4" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
                side={isMobile ? "bottom" : "right"}
                align="end"
                sideOffset={12}
              >
                <DropdownMenuLabel className="p-0 font-normal">
                  <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <span className="truncate font-medium">
                        {/* @ts-ignore */}
                        {[data?.user?.firstname, data?.user?.lastname].filter(Boolean).join(" ")}
                      </span>
                      <span className="truncate text-xs">{data?.user?.email}</span>
                    </div>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    className="cursor-pointer"
                    onClick={() => navigate("/account")}
                    data-cy="sidebar-account-menu-item"
                  >
                    <User className="w-4 h-4" />
                    {t("sidebar.userMenu.account")}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuItem className="cursor-pointer" onClick={handleLogout}>
                  <LogOut />
                  {t("sidebar.userMenu.logout")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </RootSidebar>
  )
}
