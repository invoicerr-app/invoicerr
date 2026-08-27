import {
    Building2,
    Check,
    ChevronsUpDown,
    CreditCard,
    FileText,
    LayoutDashboard,
    LogOut,
    Moon,
    Package,
    Plus,
    Receipt,
    ReceiptText,
    Settings,
    Sun,
    TrendingUp,
    User,
    Users,
    Wallet,
} from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
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
    useSidebar,
} from "@/components/ui/sidebar"

import { Badge } from "./ui/badge"
import { Button } from "./ui/button"
import OnBoarding from "./onboarding"
import type React from "react"
import { Skeleton } from "./ui/skeleton"
import { authClient } from "@/lib/auth"
import { useEffect, useRef, useState } from "react"
import { usePost } from "@/hooks/use-fetch"
import type { Company } from "@/types"

import { useCompanies, useCompany } from "@/hooks/queries"
import { useIsMobile } from "@/hooks/use-mobile"
import { useTheme } from "./theme-provider"
import { useTranslation } from "react-i18next"

export function Sidebar() {
    const { t } = useTranslation()
    const { open: isOpen } = useSidebar()
    const isMobile = useIsMobile()
    const location = useLocation()

    const { data, isPending: userLoading } = authClient.useSession()
    const { companies, activeCompanyId, isPending: companiesLoading } = useCompanies()

    const { setTheme } = useTheme()
    const { data: company } = useCompany()
    const navigate = useNavigate()

    const [onboardingOpen, setOnboardingOpen] = useState(false)
    const [createCompanyOpen, setCreateCompanyOpen] = useState(false)
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
    }, [companiesLoading, companies, location.pathname])

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

    const handleCompanyCreated = async (created: Company) => {
        await switchCompanyApi({ companyId: created.id })
        window.location.reload()
    }

    const items: { title: string; icon: React.ReactNode; url: string, dataCy: string }[] = [
        {
            title: t("sidebar.navigation.dashboard"),
            icon: <LayoutDashboard className="w-4 h-4" />,
            url: "/dashboard",
            dataCy: "sidebar-dashboard-link",
        },
        {
            title: t("sidebar.navigation.quotes"),
            icon: <FileText className="w-4 h-4" />,
            url: "/quotes",
            dataCy: "sidebar-quotes-link",
        },
        {
            title: t("sidebar.navigation.invoices"),
            icon: <ReceiptText className="w-4 h-4" />,
            url: "/invoices",
            dataCy: "sidebar-invoices-link",
        },
        {
            title: t("sidebar.navigation.payments"),
            icon: <Receipt className="w-4 h-4" />,
            url: "/payments",
            dataCy: "sidebar-payments-link",
        },
        {
            title: t("sidebar.navigation.expenses"),
            icon: <Wallet className="w-4 h-4" />,
            url: "/expenses",
            dataCy: "sidebar-expenses-link",
        },
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
            title: t("sidebar.navigation.paymentMethods"),
            icon: <CreditCard className="w-4 h-4" />,
            url: "/payment-methods",
            dataCy: "sidebar-payment-methods-link",
        },
        {
            title: t("sidebar.navigation.stats"),
            icon: <TrendingUp className="w-4 h-4" />,
            url: "/stats",
            dataCy: "sidebar-stats-link",
        },
        {
            title: t("sidebar.navigation.settings"),
            icon: <Settings className="w-4 h-4" />,
            url: "/settings",
            dataCy: "sidebar-settings-link",
        },
    ]

    const handleLogout = async () => {
        await authClient.signOut()
        navigate("/auth/sign-in")
    }

    return (
        <RootSidebar collapsible="icon">
            {/* Both the first-run auto-opened onboarding and the switcher's
                "create new company" action create a brand-new company via
                POST /api/companies — POST /api/company/info is edit-only and
                requires an already-active company, which doesn't exist yet
                in either case. */}
            <OnBoarding
                isOpen={onboardingOpen || createCompanyOpen}
                onOpenChange={(open) => {
                    setOnboardingOpen(open)
                    setCreateCompanyOpen(open)
                }}
                endpoint="/api/companies"
                onSuccess={handleCompanyCreated}
            />

            <SidebarHeader className="px-2">
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
                                            <Badge variant="outline" className="text-[10px]">{c.role}</Badge>
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
                                        setTimeout(() => setCreateCompanyOpen(true), 0)
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
                        {items.map((item, index) => (
                            <SidebarMenuItem key={index}>
                                <SidebarMenuButton asChild>
                                    <Link
                                        data-cy={item.dataCy}
                                        to={item.url}
                                        className={`flex items-center gap-2 py-6 ${location.pathname.startsWith(item.url) ? "text-sidebar-accent-foreground bg-sidebar-accent" : ""
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
                            <DropdownMenuTrigger asChild>
                                <Button variant="outline" size="icon" className={`${isOpen ? "ml-2" : ""} w-8 h-8`}>
                                    <Sun className="size-4 scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
                                    <Moon className="absolute size-4 scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
                                    <span className="sr-only">{t("sidebar.theme.toggleTheme")}</span>
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => setTheme("light")}>{t("sidebar.theme.light")}</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setTheme("dark")}>{t("sidebar.theme.dark")}</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => setTheme("system")}>{t("sidebar.theme.system")}</DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </SidebarMenuItem>

                    <SidebarMenuItem>
                        <DropdownMenu>
                            <DropdownMenuTrigger className="cursor-pointer" asChild>
                                <SidebarMenuButton
                                    size="lg"
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
                                                {data?.user?.lastname} {data?.user?.firstname}
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
                                                {data?.user?.lastname} {data?.user?.firstname}
                                            </span>
                                            <span className="truncate text-xs">{data?.user?.email}</span>
                                        </div>
                                    </div>
                                </DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                <DropdownMenuGroup>
                                    <DropdownMenuItem className="cursor-pointer">
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
