import {
  AlertTriangle,
  Armchair,
  Building2,
  CreditCard,
  FileSpreadsheet,
  FileText,
  Fingerprint,
  Hash,
  KeyRound,
  type LucideIcon,
  Mail,
  Palette,
  Radio,
  Repeat,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Tags,
  TicketIcon,
  Users,
  Wallet,
  Webhook,
} from "lucide-react"
import type { ComponentType } from "react"
import { Link, useNavigate, useParams } from "react-router"
import { useTranslation } from "react-i18next"

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useBillingStatus, useCompanies } from "@/hooks/queries"
import { useGet } from "@/hooks/use-fetch"
import { usePageHeader } from "@/hooks/use-page-header"
import { cn } from "@/lib/utils"

import AccountingExportSettings from "./_components/accounting-export.settings"
import ApiKeysSettings from "./_components/api-keys.settings"
import AtcudSettings from "./_components/atcud.settings"
import BillingSettings from "./_components/billing.settings"
import BrandingSettings from "./_components/branding.settings"
import ChannelsSettings from "./_components/channels.settings"
import CompanySettings from "./_components/company.settings"
import CustomFieldsSettings from "./_components/custom-fields.settings"
import DangerZoneSettings from "./_components/danger.settings"
import ExpenseCategoriesSettings from "./_components/expense-categories.settings"
import InvitationsSettings from "./_components/invitations.settings"
import { LogsSettings } from "./_components/logs.settings"
import MailSettings from "./_components/mail.settings"
import MembersSettings from "./_components/members.settings"
import PaymentsSettings from "./_components/payments.settings"
import RecurringSettings from "./_components/recurring.settings"
import SeatsSettings from "./_components/seats.settings"
import SigningCertificatesSettings from "./_components/signing-certificates.settings"
import SsoSettings from "./_components/sso.settings"
import EmailTemplatesSettings from "./_components/templates.settings"
import WebhooksSettings from "./_components/webhooks.settings"

/** Just enough of `GET /api/company/info` to gate the "atcud" tab below — see `atcud.settings.tsx`'s
 *  own `isPortugal` for the (deliberately loose, UX-only) country check this mirrors. */
interface CompanyCountryInfo {
  country?: string
  countryCode?: string | null
}

type TabId =
  | "company"
  | "branding"
  | "billing"
  | "recurring"
  | "payments"
  | "customFields"
  | "expenseCategories"
  | "accountingExport"
  | "email"
  | "channels"
  | "signing"
  | "atcud"
  | "mail"
  | "members"
  | "seats"
  | "invitations"
  | "sso"
  | "webhooks"
  | "apiKeys"
  | "logs"
  | "danger"

interface TabDef {
  value: TabId
  labelKey: string
  labelDefault?: string
  icon: LucideIcon
  /** `true` for a tab a plain MEMBER never sees — administration of the company itself, not of
   *  their own work. */
  adminOnly?: boolean
}

interface TabGroup {
  id: "company" | "invoicing" | "compliance" | "team" | "integrations" | "danger"
  tabs: TabDef[]
}

/**
 * The 21 tabs in the six groups the flat list already implied (company identity · invoicing rules ·
 * sending and legal compliance · people and access · developer surface · the irreversible corner).
 * Order inside a group runs from the everyday to the rare. This is the ONE declaration both the
 * desktop rail and the mobile picker are drawn from.
 */
const TAB_GROUPS: TabGroup[] = [
  {
    id: "company",
    tabs: [
      { value: "company", labelKey: "settings.tabs.company", icon: Building2 },
      {
        value: "branding",
        labelKey: "settings.tabs.branding",
        labelDefault: "Branding",
        icon: Palette,
        adminOnly: true,
      },
      // Hosted billing — see `billingAvailable` in the component below: filtered out entirely
      // (never even offered) when `GET /api/billing/status` has not answered 200.
      {
        value: "billing",
        labelKey: "settings.tabs.billing",
        labelDefault: "Subscription",
        icon: Wallet,
        adminOnly: true,
      },
    ],
  },
  {
    id: "invoicing",
    tabs: [
      { value: "recurring", labelKey: "settings.tabs.recurring", icon: Repeat },
      {
        value: "payments",
        labelKey: "settings.tabs.payments",
        labelDefault: "Payments",
        icon: CreditCard,
        adminOnly: true,
      },
      {
        value: "customFields",
        labelKey: "settings.tabs.customFields",
        labelDefault: "Custom fields",
        icon: SlidersHorizontal,
        adminOnly: true,
      },
      {
        value: "expenseCategories",
        labelKey: "settings.tabs.expenseCategories",
        labelDefault: "Expense categories",
        icon: Tags,
        adminOnly: true,
      },
      { value: "accountingExport", labelKey: "settings.tabs.accountingExport", icon: FileSpreadsheet },
      { value: "email", labelKey: "settings.tabs.emailTemplates", icon: Mail },
    ],
  },
  {
    id: "compliance",
    tabs: [
      {
        value: "channels",
        labelKey: "settings.tabs.channels",
        labelDefault: "E-invoicing",
        icon: Radio,
        adminOnly: true,
      },
      {
        value: "signing",
        labelKey: "settings.tabs.signing",
        labelDefault: "Signing certs",
        icon: ShieldCheck,
        adminOnly: true,
      },
      // Portugal only — see the `isPortugueseCompany` filter in the component below.
      { value: "atcud", labelKey: "settings.tabs.atcud", labelDefault: "ATCUD", icon: Hash, adminOnly: true },
      { value: "mail", labelKey: "settings.tabs.mail", labelDefault: "Mail", icon: Server, adminOnly: true },
    ],
  },
  {
    id: "team",
    tabs: [
      { value: "members", labelKey: "settings.tabs.members", icon: Users, adminOnly: true },
      // Hosted billing only — see `billingAvailable` in the component below: a self-hosted instance
      // has no `/api/billing/seats` route at all (the same reason "billing" itself is filtered out).
      {
        value: "seats",
        labelKey: "settings.tabs.seats",
        labelDefault: "Seats",
        icon: Armchair,
        adminOnly: true,
      },
      { value: "invitations", labelKey: "settings.tabs.invitations", icon: TicketIcon, adminOnly: true },
      // The identity provider decides who gets into the company at all, so SSO belongs with
      // members/invitations rather than with the per-user account settings.
      {
        value: "sso",
        labelKey: "settings.tabs.sso",
        labelDefault: "SSO",
        icon: Fingerprint,
        adminOnly: true,
      },
    ],
  },
  {
    id: "integrations",
    tabs: [
      { value: "webhooks", labelKey: "settings.tabs.webhooks", icon: Webhook, adminOnly: true },
      { value: "apiKeys", labelKey: "settings.tabs.apiKeys", icon: KeyRound, adminOnly: true },
      { value: "logs", labelKey: "settings.tabs.logs", icon: FileText },
    ],
  },
  {
    id: "danger",
    tabs: [{ value: "danger", labelKey: "settings.tabs.dangerZone", icon: AlertTriangle, adminOnly: true }],
  },
]

const CONTENT: Record<TabId, ComponentType> = {
  company: CompanySettings,
  branding: BrandingSettings,
  billing: BillingSettings,
  recurring: RecurringSettings,
  payments: PaymentsSettings,
  customFields: CustomFieldsSettings,
  expenseCategories: ExpenseCategoriesSettings,
  accountingExport: AccountingExportSettings,
  email: EmailTemplatesSettings,
  channels: ChannelsSettings,
  signing: SigningCertificatesSettings,
  atcud: AtcudSettings,
  mail: MailSettings,
  members: MembersSettings,
  seats: SeatsSettings,
  invitations: InvitationsSettings,
  sso: SsoSettings,
  webhooks: WebhooksSettings,
  apiKeys: ApiKeysSettings,
  logs: LogsSettings,
  danger: DangerZoneSettings,
}

export default function Settings() {
  const { t } = useTranslation()
  const { tab } = useParams()
  const navigate = useNavigate()
  const { activeRole } = useCompanies()
  const isMember = activeRole === "MEMBER"
  const { data: company } = useGet<CompanyCountryInfo>("/api/company/info")
  const companyCountryValue = (company?.countryCode || company?.country || "").trim().toUpperCase()
  const isPortugueseCompany = companyCountryValue === "PT" || companyCountryValue === "PORTUGAL"
  // Hosted billing (product decision 2026-09-15) — `GET /api/billing/status` 200 is the ONLY signal
  // this frontend has that the feature exists on this instance at all (`use-billing.ts`'s own
  // header). `isSuccess` false (404 on a self-hosted instance, or still loading) hides the tab
  // entirely, both from the nav AND from the valid-tab set — so a direct `/settings/billing`
  // navigation on an instance without billing falls back to "company" rather than rendering a
  // half-populated screen.
  const { isSuccess: billingAvailable } = useBillingStatus()

  // "atcud" only ever applies to a company registered in Portugal — see `atcud.settings.tsx`'s own
  // header. Hidden here rather than merely showing an empty/inapplicable screen: a French or Polish
  // company has no reason to ever see a nav entry for a Portuguese-only legal requirement. The
  // component itself still gates on the SAME check (`isPortugal`) if this tab is ever reached
  // directly (e.g. a stale bookmark from before the company's own country changed).
  const groups = TAB_GROUPS.map((group) => ({
    ...group,
    tabs: group.tabs.filter(
      (item) =>
        (!isMember || !item.adminOnly) &&
        (item.value !== "billing" || billingAvailable) &&
        (item.value !== "seats" || billingAvailable) &&
        (item.value !== "atcud" || isPortugueseCompany),
    ),
  })).filter((group) => group.tabs.length > 0)
  const visibleTabs = groups.flatMap((group) => group.tabs)

  // The URL is the only source of truth for the active tab. Anything not offered to THIS user
  // (unknown, hidden by role, billing not available) falls back to "company" — the same fallback
  // a MEMBER hitting a bookmarked admin tab gets, never a blank pane.
  const isTabId = (value: string | undefined): value is TabId =>
    visibleTabs.some((item) => item.value === value)
  const currentTab: TabId = isTabId(tab) ? tab : "company"
  const currentItem = visibleTabs.find((item) => item.value === currentTab)
  const label = (item: TabDef) => (item.labelDefault ? t(item.labelKey, item.labelDefault) : t(item.labelKey))

  usePageHeader(t("settings.title"))

  const Content = CONTENT[currentTab]

  return (
    <div className="flex h-full flex-col lg:flex-row">
      {/* Below `lg` the rail becomes a grouped picker: one control, always in reach, instead of a
          21-entry list pushing the content a screen down. */}
      <div className="border-b px-4 py-3 lg:hidden">
        <Select value={currentTab} onValueChange={(value) => navigate(`/settings/${value}`)}>
          <SelectTrigger
            className="h-11 w-full"
            aria-label={t("settings.common.navSelectLabel")}
            data-cy="settings-nav-select"
          >
            <SelectValue>
              <span className="flex items-center gap-2">
                {currentItem && (
                  <currentItem.icon className="size-4 text-muted-foreground" aria-hidden="true" />
                )}
                {currentItem && label(currentItem)}
              </span>
            </SelectValue>
          </SelectTrigger>
          <SelectContent data-cy="settings-nav-select-options">
            {groups.map((group) => (
              <SelectGroup key={group.id}>
                <SelectLabel className="text-xs uppercase tracking-wider text-muted-foreground">
                  {t(`settings.nav.groups.${group.id}`)}
                </SelectLabel>
                {group.tabs.map((item) => (
                  <SelectItem
                    key={item.value}
                    value={item.value}
                    data-cy={`settings-nav-option-${item.value}`}
                    className={cn(
                      item.value === "danger" && "text-destructive data-[highlighted]:text-destructive",
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <item.icon className="size-4 text-muted-foreground" aria-hidden="true" />
                      {label(item)}
                    </span>
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* The desktop rail: real links (middle-click, keyboard, screen reader all work), grouped
          under small-caps labels, the active one on the accent ground rather than a filled block —
          it is a "you are here", not a button to press. */}
      <aside className="hidden w-60 shrink-0 border-r bg-sidebar/60 lg:block">
        <nav
          aria-label={t("settings.common.navLabel")}
          className="sticky top-0 px-3 py-5"
          data-cy="settings-nav"
        >
          {groups.map((group) => (
            <div key={group.id} className="mb-5 last:mb-0">
              <p className="mb-1 px-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {t(`settings.nav.groups.${group.id}`)}
              </p>
              <ul className="grid gap-0.5">
                {group.tabs.map((item) => {
                  const active = item.value === currentTab
                  const danger = item.value === "danger"
                  return (
                    <li key={item.value}>
                      <Link
                        to={`/settings/${item.value}`}
                        aria-current={active ? "page" : undefined}
                        data-cy={`settings-nav-${item.value}`}
                        className={cn(
                          "flex items-center gap-2.5 rounded-md px-3 py-1.5 text-sm outline-none transition-colors duration-150 focus-visible:ring-[3px] focus-visible:ring-ring/50",
                          active
                            ? "bg-accent font-medium text-accent-foreground"
                            : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                          danger && !active && "text-destructive/80 hover:text-destructive",
                          danger && active && "bg-destructive-soft text-destructive-soft-foreground",
                        )}
                      >
                        <item.icon
                          className="size-4 shrink-0"
                          strokeWidth={active ? 2 : 1.75}
                          aria-hidden="true"
                        />
                        <span className="truncate">{label(item)}</span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </nav>
      </aside>

      <main className="flex-1 overflow-auto px-4 py-6 sm:px-6" data-cy={`settings-tab-${currentTab}`}>
        <div className="mx-auto max-w-4xl">
          <Content />
        </div>
      </main>
    </div>
  )
}
