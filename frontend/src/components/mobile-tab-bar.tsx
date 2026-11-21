import { Ellipsis, LayoutDashboard, Users } from "lucide-react"
import type React from "react"
import { useTranslation } from "react-i18next"
import { Link, useLocation } from "react-router"

import { documentTypeIcon } from "@/components/documents/document-type-icon"
import { useSidebar } from "@/components/ui/sidebar"
import { useAvailableDocumentTypes } from "@/hooks/queries"
import { cn } from "@/lib/utils"

interface TabProps {
  label: string
  icon: React.ElementType
  active: boolean
  to?: string
  onClick?: () => void
  dataCy: string
}

function Tab({ label, icon: Icon, active, to, onClick, dataCy }: TabProps) {
  const className = cn(
    "focus-ring flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-md text-xs font-medium",
    active ? "text-foreground" : "text-muted-foreground",
  )
  const content = (
    <>
      <span
        className={cn(
          "grid h-7 w-12 place-items-center rounded-full transition-colors duration-150",
          active && "bg-accent text-accent-foreground",
        )}
      >
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <span className="max-w-full truncate">{label}</span>
    </>
  )
  if (to) {
    return (
      <Link to={to} className={className} aria-current={active ? "page" : undefined} data-cy={dataCy}>
        {content}
      </Link>
    )
  }
  return (
    <button type="button" className={className} onClick={onClick} data-cy={dataCy}>
      {content}
    </button>
  )
}

export function isNewDocumentPath(pathname: string): boolean {
  return /^\/documents\/[^/]+\/new$/.test(pathname)
}

/** The phone's own navigation: the three places used every day, and "More" for the full sidebar. */
export function MobileTabBar() {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const { setOpenMobile } = useSidebar()
  const { data: available } = useAvailableDocumentTypes()
  const documentsTypeId = "invoice"
  const documentsIcon = documentTypeIcon(available?.types.find((type) => type.id === documentsTypeId)?.icon)
  // The new-record page has its own close button and action bar at the bottom.
  if (isNewDocumentPath(pathname)) return null
  return (
    <nav
      aria-label={t("sidebar.mobile.navLabel")}
      className="fixed inset-x-0 bottom-0 z-30 flex border-t bg-card px-2 pb-[env(safe-area-inset-bottom)] md:hidden"
      data-cy="mobile-tab-bar"
    >
      <Tab
        label={t("sidebar.mobile.home")}
        icon={LayoutDashboard}
        to="/dashboard"
        active={pathname.startsWith("/dashboard")}
        dataCy="mobile-tab-dashboard"
      />
      <Tab
        label={t("sidebar.navigation.documents")}
        icon={documentsIcon}
        to={`/documents/${documentsTypeId}`}
        active={pathname.startsWith("/documents")}
        dataCy="mobile-tab-documents"
      />
      <Tab
        label={t("sidebar.navigation.clients")}
        icon={Users}
        to="/clients"
        active={pathname.startsWith("/clients")}
        dataCy="mobile-tab-clients"
      />
      <Tab
        label={t("sidebar.mobile.more")}
        icon={Ellipsis}
        active={false}
        onClick={() => setOpenMobile(true)}
        dataCy="mobile-tab-more"
      />
    </nav>
  )
}
