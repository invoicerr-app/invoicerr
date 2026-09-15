import {
  AlertTriangle,
  Building2,
  CreditCard,
  FileSpreadsheet,
  FileText,
  Fingerprint,
  Hash,
  KeyRound,
  Mail,
  Palette,
  Plug,
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useNavigate, useParams } from "react-router"

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
import PaymentsSettings from "./_components/payments.settings"
import EmailTemplatesSettings from "./_components/templates.settings"
import InvitationsSettings from "./_components/invitations.settings"
import MailSettings from "./_components/mail.settings"
import MembersSettings from "./_components/members.settings"
import PluginsSettings from "./_components/plugins.settings"
import RecurringSettings from "./_components/recurring.settings"
import SigningCertificatesSettings from "./_components/signing-certificates.settings"
import SsoSettings from "./_components/sso.settings"
import WebhooksSettings from "./_components/webhooks.settings"
import { cn } from "@/lib/utils"
import { usePageHeader } from "@/hooks/use-page-header"
import { useBillingStatus, useCompanies } from "@/hooks/queries"
import { useGet } from "@/hooks/use-fetch"
import { useTranslation } from "react-i18next"
import { LogsSettings } from "./_components/logs.settings"

/** Just enough of `GET /api/company/info` to gate the "atcud" tab below — see `atcud.settings.tsx`'s
 *  own `isPortugal` for the (deliberately loose, UX-only) country check this mirrors. */
interface CompanyCountryInfo {
  country?: string
  countryCode?: string | null
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
  // entirely, both from the nav below AND from `validTabs` — so a direct `/settings/billing`
  // navigation on an instance without billing falls back to "company" rather than rendering a
  // half-populated screen.
  const { isSuccess: billingAvailable } = useBillingStatus()

  const validTabs = [
    "company",
    "branding",
    "email",
    "mail",
    "webhooks",
    "apiKeys",
    "logs",
    "invitations",
    "members",
    "plugins",
    "channels",
    "payments",
    "signing",
    "atcud",
    "sso",
    "recurring",
    "customFields",
    "expenseCategories",
    "accountingExport",
    ...(billingAvailable ? ["billing"] : []),
    "danger",
  ]
  const currentTab = validTabs.includes(tab!) ? tab! : "company"

  const handleTabChange = (newTab: string) => {
    navigate(`/settings/${newTab}`)
  }

  const menuItems = [
    {
      value: "company",
      label: t("settings.tabs.company"),
      icon: Building2,
    },
    {
      value: "branding",
      label: t("settings.tabs.branding", "Branding"),
      icon: Palette,
    },
    {
      value: "email",
      label: t("settings.tabs.emailTemplates"),
      icon: Mail,
    },
    {
      value: "mail",
      label: t("settings.tabs.mail", "Mail"),
      icon: Server,
    },
    {
      value: "webhooks",
      label: t("settings.tabs.webhooks"),
      icon: Webhook,
    },
    {
      value: "apiKeys",
      label: t("settings.tabs.apiKeys"),
      icon: KeyRound,
    },
    {
      value: "logs",
      label: t("settings.tabs.logs"),
      icon: FileText,
    },
    {
      value: "invitations",
      label: t("settings.tabs.invitations"),
      icon: TicketIcon,
    },
    {
      value: "members",
      label: t("settings.tabs.members"),
      icon: Users,
    },
    {
      value: "plugins",
      label: t("settings.tabs.plugins"),
      icon: Plug,
    },
    {
      value: "channels",
      label: t("settings.tabs.channels", "E-invoicing"),
      icon: Radio,
    },
    {
      value: "payments",
      label: t("settings.tabs.payments", "Payments"),
      icon: CreditCard,
    },
    {
      value: "signing",
      label: t("settings.tabs.signing", "Signing certs"),
      icon: ShieldCheck,
    },
    {
      value: "atcud",
      label: t("settings.tabs.atcud", "ATCUD"),
      icon: Hash,
    },
    {
      value: "sso",
      label: t("settings.tabs.sso", "SSO"),
      icon: Fingerprint,
    },
    {
      value: "recurring",
      label: t("settings.tabs.recurring"),
      icon: Repeat,
    },
    {
      value: "customFields",
      label: t("settings.tabs.customFields", "Custom fields"),
      icon: SlidersHorizontal,
    },
    {
      value: "expenseCategories",
      label: t("settings.tabs.expenseCategories", "Expense categories"),
      icon: Tags,
    },
    {
      value: "accountingExport",
      label: t("settings.tabs.accountingExport"),
      icon: FileSpreadsheet,
    },
    // Hosted billing — see this component's own `billingAvailable` comment above `validTabs`. Filtered
    // OUT below (never even added to the array) when `GET /api/billing/status` has not answered 200.
    ...(billingAvailable
      ? [{ value: "billing", label: t("settings.tabs.billing", "Subscription"), icon: Wallet }]
      : []),
    {
      value: "danger",
      label: t("settings.tabs.dangerZone"),
      icon: AlertTriangle,
    },
  ]
    .filter(
      (item) =>
        !isMember ||
        // "sso" joins the administrative tabs a MEMBER never sees: the identity provider decides who
        // gets into the company at all, so it belongs with members/invitations rather than with the
        // per-user account settings. "billing" joins them too — subscription management is an
        // OWNER/ADMIN concern.
        ![
          "invitations",
          "members",
          "apiKeys",
          "webhooks",
          "danger",
          "channels",
          "payments",
          "signing",
          "atcud",
          "sso",
          "customFields",
          "expenseCategories",
          "mail",
          "branding",
          "billing",
        ].includes(item.value),
    )
    // "atcud" only ever applies to a company registered in Portugal — see `atcud.settings.tsx`'s own
    // header. Hidden here rather than merely showing an empty/inapplicable screen: a French or Polish
    // company has no reason to ever see a nav entry for a Portuguese-only legal requirement. The
    // component itself still gates on the SAME check (`isPortugal`) if this tab is ever reached
    // directly (e.g. a stale bookmark from before the company's own country changed).
    .filter((item) => item.value !== "atcud" || isPortugueseCompany)

  const currentMenuItem = menuItems.find((item) => item.value === currentTab)

  usePageHeader(t("settings.title"))

  const renderContent = () => {
    switch (currentTab) {
      case "company":
        return <CompanySettings />
      case "branding":
        return <BrandingSettings />
      case "email":
        return <EmailTemplatesSettings />
      case "mail":
        return <MailSettings />
      case "webhooks":
        return <WebhooksSettings />
      case "apiKeys":
        return <ApiKeysSettings />
      case "logs":
        return <LogsSettings />
      case "invitations":
        return <InvitationsSettings />
      case "members":
        return <MembersSettings />
      case "plugins":
        return <PluginsSettings />
      case "channels":
        return <ChannelsSettings />
      case "payments":
        return <PaymentsSettings />
      case "signing":
        return <SigningCertificatesSettings />
      case "atcud":
        return <AtcudSettings />
      case "sso":
        return <SsoSettings />
      case "recurring":
        return <RecurringSettings />
      case "customFields":
        return <CustomFieldsSettings />
      case "expenseCategories":
        return <ExpenseCategoriesSettings />
      case "accountingExport":
        return <AccountingExportSettings />
      case "billing":
        return <BillingSettings />
      case "danger":
        return <DangerZoneSettings />
      default:
        return <CompanySettings />
    }
  }

  return (
    <div className="h-full flex flex-col lg:flex-row">
      <div className="lg:hidden p-4">
        <Select value={currentTab} onValueChange={handleTabChange}>
          <SelectTrigger className="w-full h-12">
            <SelectValue>
              <div className="flex items-center gap-2">
                {currentMenuItem?.icon && <currentMenuItem.icon className="h-4 w-4" />}
                {currentMenuItem?.label}
              </div>
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {menuItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                <div className="flex items-center gap-2">
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <aside className="hidden lg:flex flex-col w-64 shrink-0 border-r bg-muted/30">
        <nav className="flex-1 px-3 pb-6 pt-6">
          <ul className="space-y-1">
            {menuItems.map((item) => (
              <li key={item.value}>
                <button
                  onClick={() => handleTabChange(item.value)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                    currentTab === item.value
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      <main className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto">{renderContent()}</div>
      </main>
    </div>
  )
}
