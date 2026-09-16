"use client"

import { Copy } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useCompanies } from "@/hooks/queries"
import { useGet, usePost, usePut, useDelete } from "@/hooks/use-fetch"
import { useMutationWithToast } from "@/hooks/use-mutation-with-toast"
import type { Company } from "@/types"

import { SettingsFormFooter, SettingsPage, SettingsSection } from "./settings-section"

type ChannelEnvironment = "TEST" | "PROD"

interface ConfiguredChannel {
  providerId: string
  environment: ChannelEnvironment
  isActive: boolean
}
interface ChannelsResponse {
  configured: ConfiguredChannel[]
}

interface PaymentProviderField {
  key: string
  label: string
  placeholder?: string
  password?: boolean
}

/**
 * Online payment — Settings → Payments. One `PaymentProviderCard` per
 * registered `PaymentProvider` (`backend/.../payments/payment-provider-registry.ts`) — Stripe → Mollie
 * → PayPal, in that product-decided order (2026-09-15) — all sharing the SAME storage mechanism
 * (`PUT/DELETE /api/company/channels/:providerId`, the encrypted `CompanyChannelConfig` table every
 * national channel already uses) and the same bring-your-own-account model this screen's own original
 * header already explained for Stripe: never folded into `channels.settings.tsx`'s "E-invoicing" tab,
 * since "how does a client PAY this company" is a categorically different question from "which national
 * TRANSPORT delivers a document".
 *
 * Each provider declares its OWN field list (`PAYMENT_PROVIDERS` below) — adding a fourth provider is
 * exactly one more entry, never a new component. Stripe's own `data-cy` attributes are UNCHANGED from
 * before this refactor (`payment-provider-stripe-*`) — `60-online-payment.cy.ts` depends on them. Each
 * card is its OWN `SettingsSection` with its own "Connect" primary: these are unrelated third-party
 * accounts a company opts into independently, so — unlike a single-form tab — more than one card's
 * primary can be on screen at once (a fresh company sees all three at once, unconnected).
 */
export default function PaymentsSettings() {
  const { t } = useTranslation()
  const { data: channels, mutate } = useGet<ChannelsResponse>("/api/company/channels")

  return (
    <SettingsPage
      title={t("settings.payments.title", "Payments")}
      description={t(
        "settings.payments.description",
        "Connect a payment provider so a Pay link appears on invoices in the client portal.",
      )}
      dataCy="payments-section"
    >
      <ActiveProviderSelector channels={channels} />

      {PAYMENT_PROVIDERS.map((provider) => (
        <PaymentProviderCard key={provider.id} provider={provider} channels={channels} mutate={mutate} />
      ))}
    </SettingsPage>
  )
}

/** The backend's own `DEFAULT_PROVIDER_ID` (`payments/payment-sessions.service.ts`), mirrored here so
 *  this selector shows what the Pay link actually opens TODAY for a company that never explicitly
 *  chose — never a blank/undefined value that would look like nothing is active when something,
 *  in fact, silently is. */
const DEFAULT_PAYMENT_PROVIDER_ID = "stripe"

/**
 * Which CONNECTED provider's Pay link a client actually sees (`Company.paymentProviderId`) — a
 * DIFFERENT question from "is provider X connected" (each `PaymentProviderCard` above, independently):
 * bring-your-own-account lets a company hold credentials for more than one provider at once (e.g.
 * testing Mollie alongside an already-live Stripe), so which one is ACTIVE for the portal's Pay link
 * must be its own explicit choice — see `Company.paymentProviderId`'s own schema.prisma comment,
 * which already promised "its own small selector on the Payments settings screen" that this component
 * is. Hidden entirely until at least one provider is connected: there is nothing to choose between
 * before then, and the fallback (`DEFAULT_PAYMENT_PROVIDER_ID`) is already exactly what an untouched
 * company gets.
 */
function ActiveProviderSelector({ channels }: { channels: ChannelsResponse | null | undefined }) {
  const { t } = useTranslation()
  const { data: company, mutate: refetchCompany } = useGet<Company>("/api/company/info")
  const { trigger: save } = useMutationWithToast(
    usePost<Company>("/api/company/info"),
    t("settings.payments.messages.activeProviderError", "Failed to update the active payment provider"),
  )

  const connectedIds = new Set(
    (channels?.configured ?? []).filter((c) => c.isActive).map((c) => c.providerId),
  )
  if (connectedIds.size === 0) return null

  const current = company?.paymentProviderId || DEFAULT_PAYMENT_PROVIDER_ID

  const handleChange = async (value: string) => {
    const result = await save({ paymentProviderId: value })
    if (!result) return // error already toasted by the wrapper
    toast.success(t("settings.payments.messages.activeProviderSuccess", "Active payment provider updated"))
    refetchCompany()
  }

  return (
    <SettingsSection
      title={t("settings.payments.activeProvider.title", "Active provider")}
      description={t(
        "settings.payments.activeProvider.description",
        "Which connected provider the client portal's Pay link opens, when more than one is connected.",
      )}
      dataCy="payment-active-provider-card"
    >
      <Select value={current} onValueChange={handleChange}>
        <SelectTrigger className="w-full sm:w-64" data-cy="payment-active-provider-select">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PAYMENT_PROVIDERS.filter((provider) => connectedIds.has(provider.id)).map((provider) => (
            <SelectItem
              key={provider.id}
              value={provider.id}
              data-cy={`payment-active-provider-option-${provider.id}`}
            >
              {provider.title}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingsSection>
  )
}

interface PaymentProviderDef {
  id: string
  title: string
  descriptionKey: string
  descriptionFallback: string
  fields: PaymentProviderField[]
  /** Whether this provider needs a manually-registered webhook endpoint (Stripe/PayPal: the company
   *  pastes this URL into their OWN dashboard to get a signing secret/webhook id back). Mollie needs
   *  NONE of that — its webhook URL is passed programmatically on every payment this backend creates
   *  (`mollie-provider.ts`'s own header), so there is nothing for a human to register anywhere. */
  showWebhookUrl: boolean
  webhookHintKey?: string
  webhookHintFallback?: string
  /** PayPal alone needs BOTH the shared TEST/PROD channel environment AND its own `sandbox`/`live`
   *  value INSIDE `config` (`paypal-provider.ts#extractPayPalCredentials`'s own header explains why) —
   *  derived from the SAME select, never a second one. */
  needsConfigEnvironment: boolean
}

const PAYMENT_PROVIDERS: PaymentProviderDef[] = [
  {
    id: "stripe",
    title: "Stripe",
    descriptionKey: "settings.payments.stripeDescription",
    descriptionFallback:
      "Bring your own Stripe account — this app never sees a card number or holds your secret keys anywhere but encrypted, and the payment page is always Stripe's own.",
    fields: [
      {
        key: "secretKey",
        label: "settings.payments.fields.secretKey",
        placeholder: "sk_test_...",
        password: true,
      },
      {
        key: "webhookSecret",
        label: "settings.payments.fields.webhookSecret",
        placeholder: "whsec_...",
        password: true,
      },
    ],
    showWebhookUrl: true,
    webhookHintKey: "settings.payments.webhookUrl.hint",
    webhookHintFallback:
      "Register this exact URL as a webhook endpoint in your Stripe dashboard (event: checkout.session.completed), then paste the signing secret it gives you below.",
    needsConfigEnvironment: false,
  },
  {
    id: "mollie",
    title: "Mollie",
    descriptionKey: "settings.payments.mollieDescription",
    descriptionFallback:
      "Bring your own Mollie account — paste your API key, nothing else to register: invoicerr passes the webhook URL automatically on every payment it creates.",
    fields: [
      { key: "apiKey", label: "settings.payments.fields.apiKey", placeholder: "test_...", password: true },
    ],
    showWebhookUrl: false,
    needsConfigEnvironment: false,
  },
  {
    id: "paypal",
    title: "PayPal",
    descriptionKey: "settings.payments.paypalDescription",
    descriptionFallback:
      "Bring your own PayPal account — this app never sees card or bank details, and the payment page is always PayPal's own.",
    fields: [
      { key: "clientId", label: "settings.payments.fields.clientId", placeholder: "" },
      {
        key: "clientSecret",
        label: "settings.payments.fields.clientSecret",
        placeholder: "",
        password: true,
      },
      { key: "webhookId", label: "settings.payments.fields.webhookId", placeholder: "" },
    ],
    showWebhookUrl: true,
    webhookHintKey: "settings.payments.webhookUrl.hintPaypal",
    webhookHintFallback:
      "Register this exact URL as a webhook in your PayPal app (events: CHECKOUT.ORDER.APPROVED and PAYMENT.CAPTURE.COMPLETED), then paste the Webhook ID it gives you below.",
    needsConfigEnvironment: true,
  },
]

function PaymentProviderCard({
  provider,
  channels,
  mutate,
}: {
  provider: PaymentProviderDef
  channels: ChannelsResponse | null | undefined
  mutate: () => void
}) {
  const { t } = useTranslation()
  const { activeCompanyId } = useCompanies()

  const configured = channels?.configured.find((c) => c.providerId === provider.id)
  const isConnected = !!configured?.isActive
  const [editing, setEditing] = useState(!isConnected)
  const [environment, setEnvironment] = useState<ChannelEnvironment>("TEST")
  const [values, setValues] = useState<Record<string, string>>({})

  const backendUrl = import.meta.env.VITE_BACKEND_URL || ""
  const webhookUrl = activeCompanyId
    ? `${backendUrl}/api/public/payments/${provider.id}/${activeCompanyId}/webhook`
    : ""

  const { trigger: upsert, loading: connecting } = useMutationWithToast(
    usePut(`/api/company/channels/${provider.id}`),
    t("settings.payments.messages.connectError", "Failed to connect the payment provider"),
  )
  const { trigger: disconnect, loading: disconnecting } = useMutationWithToast(
    useDelete(`/api/company/channels/${provider.id}`),
    t("settings.payments.messages.disconnectError", "Failed to disconnect the payment provider"),
  )

  const copyWebhookUrl = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl)
      toast.success(t("settings.payments.messages.copied", "Copied to clipboard"))
    } catch {
      // A clipboard permission refusal is not an error worth a red toast — the value is on screen and
      // selectable either way.
    }
  }

  const handleConnect = async () => {
    if (provider.fields.some((field) => !values[field.key]?.trim())) {
      toast.error(t("settings.payments.messages.fieldsRequired", "All fields for this provider are required"))
      return
    }
    const config: Record<string, string> = { ...values }
    if (provider.needsConfigEnvironment) {
      // See `PaymentProviderDef.needsConfigEnvironment`'s own header — PayPal reads THIS field out of
      // `config`, never off the channel row's own `environment` column.
      config.environment = environment === "PROD" ? "live" : "sandbox"
    }
    const result = await upsert({ environment, config })
    if (!result) return // error already toasted by the wrapper
    toast.success(t("settings.payments.messages.connectSuccess", "Payment provider connected"))
    setValues({})
    setEditing(false)
    mutate()
  }

  const handleDisconnect = async () => {
    const result = await disconnect()
    if (!result) return // error already toasted by the wrapper
    toast.success(t("settings.payments.messages.disconnectSuccess", "Payment provider disconnected"))
    setEditing(true)
    mutate()
  }

  const hasWebhookBlock = provider.showWebhookUrl
  const content =
    hasWebhookBlock || editing ? (
      <div className="space-y-4">
        {hasWebhookBlock && (
          // Needed BEFORE connecting — it is what gets registered as a webhook endpoint in the
          // provider's own dashboard in order to obtain the value one of the fields below asks for.
          <div className="space-y-1.5">
            <Label htmlFor={`payment-webhook-url-${provider.id}`}>
              {t("settings.payments.webhookUrl.label", "Webhook URL")}
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id={`payment-webhook-url-${provider.id}`}
                readOnly
                className="font-mono"
                value={webhookUrl}
                data-cy={`payment-webhook-url-${provider.id}`}
              />
              <Button
                variant="outline"
                size="icon"
                onClick={copyWebhookUrl}
                aria-label={t("settings.common.copy", "Copy")}
                tooltip={t("settings.common.copy", "Copy")}
                data-cy={`payment-webhook-url-${provider.id}-copy-button`}
              >
                <Copy aria-hidden="true" />
              </Button>
            </div>
            {provider.webhookHintKey && (
              <p className="text-xs text-muted-foreground">
                {t(provider.webhookHintKey, provider.webhookHintFallback ?? "")}
              </p>
            )}
          </div>
        )}

        {editing && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`payment-environment-${provider.id}`}>
                {t("settings.payments.fields.environment", "Environment")}
              </Label>
              <Select value={environment} onValueChange={(v) => setEnvironment(v as ChannelEnvironment)}>
                <SelectTrigger
                  id={`payment-environment-${provider.id}`}
                  className="w-full"
                  data-cy={`payment-provider-${provider.id}-environment-select`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    value="TEST"
                    data-cy={`payment-provider-${provider.id}-environment-option-test`}
                  >
                    {t("settings.payments.fields.environmentTest", "Test")}
                  </SelectItem>
                  <SelectItem
                    value="PROD"
                    data-cy={`payment-provider-${provider.id}-environment-option-prod`}
                  >
                    {t("settings.payments.fields.environmentProd", "Live")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            {provider.fields.map((field) => (
              <div className="space-y-1.5" key={field.key}>
                <Label htmlFor={`payment-${provider.id}-${field.key}`}>{t(field.label, field.key)}</Label>
                <Input
                  id={`payment-${provider.id}-${field.key}`}
                  type={field.password ? "password" : "text"}
                  placeholder={field.placeholder}
                  value={values[field.key] ?? ""}
                  onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                  data-cy={`payment-provider-${provider.id}-${field.key.toLowerCase()}-input`}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    ) : null

  return (
    <SettingsSection
      dataCy={`payment-provider-${provider.id}`}
      title={provider.title}
      description={t(provider.descriptionKey, provider.descriptionFallback)}
      aside={
        <>
          <Badge
            variant={isConnected ? "success" : "secondary"}
            data-cy={`payment-provider-${provider.id}-status`}
          >
            {isConnected
              ? t("settings.payments.status.connected", "Connected ({{environment}})", {
                  environment: configured?.environment,
                })
              : t("settings.payments.status.notConnected", "Not connected")}
          </Badge>
          {isConnected && !editing && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditing(true)}
              data-cy={`payment-provider-${provider.id}-edit-button`}
            >
              {t("settings.payments.actions.edit", "Edit")}
            </Button>
          )}
          {isConnected && !editing && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleDisconnect}
              loading={disconnecting}
              data-cy={`payment-provider-${provider.id}-disconnect-button`}
            >
              {t("settings.payments.actions.disconnect", "Disconnect")}
            </Button>
          )}
        </>
      }
      footer={
        editing ? (
          <SettingsFormFooter>
            {isConnected && (
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                {t("settings.payments.actions.cancel", "Cancel")}
              </Button>
            )}
            <Button
              onClick={handleConnect}
              loading={connecting}
              data-cy={`payment-provider-${provider.id}-connect-button`}
            >
              {t("settings.payments.actions.connect", "Connect")}
            </Button>
          </SettingsFormFooter>
        ) : undefined
      }
    >
      {content}
    </SettingsSection>
  )
}
