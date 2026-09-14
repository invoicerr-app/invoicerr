"use client"

import { CheckCircle2, Copy, Loader2, XCircle } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useCompanies } from "@/hooks/queries"
import { useGet, usePut, useDelete } from "@/hooks/use-fetch"
import { useMutationWithToast } from "@/hooks/use-mutation-with-toast"

type ChannelEnvironment = "TEST" | "PROD"

interface ConfiguredChannel {
  providerId: string
  environment: ChannelEnvironment
  isActive: boolean
}
interface ChannelsResponse {
  configured: ConfiguredChannel[]
}

const PROVIDER_ID = "stripe"

/**
 * TODO_FEATURES.md rank 1 ("paiement en ligne") — Settings → Payments. Deliberately its OWN screen,
 * never a row folded into `channels.settings.tsx`'s own "E-invoicing" tab: that screen is about which
 * national TRANSPORT delivers a document (per-country suggested/mandated, `TransportRegistry`-backed —
 * see its own header), a categorically different concept from "how does a client PAY this company"
 * (see the backend's own `PaymentSessionsService` header, decision 1, on why a payment provider is its
 * own narrow interface, never a `DocumentTransport`). The two screens DO share their storage mechanism
 * — `PUT/DELETE /api/company/channels/:providerId`, the exact same encrypted `CompanyChannelConfig`
 * table every national channel already uses (decision 2: bring-your-own-account, per company) — reused
 * here for exactly that reason, not because payments and e-invoicing are the same idea.
 *
 * Stripe is bring-your-own-account: this company pastes ITS OWN secret key and webhook secret, and
 * registers THIS app's own webhook URL (shown below, always — needed BEFORE connecting, to set up the
 * Stripe dashboard side first) in its OWN Stripe dashboard. No client-side Stripe.js key is collected —
 * the payment PAGE is Stripe's own hosted Checkout, never rendered by this app (see
 * `payments/provider.ts`'s own header), so a publishable key would have no use here.
 */
export default function PaymentsSettings() {
  const { t } = useTranslation()
  const { activeCompanyId } = useCompanies()
  const { data: channels, mutate } = useGet<ChannelsResponse>("/api/company/channels")

  const configured = channels?.configured.find((c) => c.providerId === PROVIDER_ID)
  const isConnected = !!configured?.isActive
  const [editing, setEditing] = useState(!isConnected)
  const [environment, setEnvironment] = useState<ChannelEnvironment>("TEST")
  const [secretKey, setSecretKey] = useState("")
  const [webhookSecret, setWebhookSecret] = useState("")

  const backendUrl = import.meta.env.VITE_BACKEND_URL || ""
  const webhookUrl = activeCompanyId
    ? `${backendUrl}/api/public/payments/${PROVIDER_ID}/${activeCompanyId}/webhook`
    : ""

  const { trigger: upsert, loading: connecting } = useMutationWithToast(
    usePut(`/api/company/channels/${PROVIDER_ID}`),
    t("settings.payments.messages.connectError", "Failed to connect the payment provider"),
  )
  const { trigger: disconnect, loading: disconnecting } = useMutationWithToast(
    useDelete(`/api/company/channels/${PROVIDER_ID}`),
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
    if (!secretKey.trim() || !webhookSecret.trim()) {
      toast.error(
        t("settings.payments.messages.fieldsRequired", "Secret key and webhook secret are both required"),
      )
      return
    }
    const result = await upsert({ environment, config: { secretKey, webhookSecret } })
    if (!result) return // error already toasted by the wrapper
    toast.success(t("settings.payments.messages.connectSuccess", "Payment provider connected"))
    setSecretKey("")
    setWebhookSecret("")
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

  return (
    <div className="space-y-6" data-cy="payments-section">
      <div>
        <h1 className="text-2xl font-bold mb-2">{t("settings.payments.title", "Payments")}</h1>
        <p className="text-muted-foreground">
          {t(
            "settings.payments.description",
            "Connect a payment provider so a Pay link appears on invoices in the client portal.",
          )}
        </p>
      </div>

      <Card data-cy="payment-provider-stripe">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {isConnected ? (
                <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
              ) : (
                <XCircle className="h-5 w-5 text-muted-foreground shrink-0" />
              )}
              <CardTitle className="text-base">Stripe</CardTitle>
              <Badge variant={isConnected ? "default" : "secondary"} data-cy="payment-provider-stripe-status">
                {isConnected
                  ? t("settings.payments.status.connected", "Connected ({{environment}})", {
                      environment: configured?.environment,
                    })
                  : t("settings.payments.status.notConnected", "Not connected")}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              {isConnected && !editing && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditing(true)}
                  data-cy="payment-provider-stripe-edit-button"
                >
                  {t("settings.payments.actions.edit", "Edit")}
                </Button>
              )}
              {isConnected && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                  data-cy="payment-provider-stripe-disconnect-button"
                >
                  {disconnecting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    t("settings.payments.actions.disconnect", "Disconnect")
                  )}
                </Button>
              )}
            </div>
          </div>
          <CardDescription>
            {t(
              "settings.payments.stripeDescription",
              "Bring your own Stripe account — this app never sees a card number or holds your secret keys anywhere but encrypted, and the payment page is always Stripe's own.",
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Needed BEFORE connecting — it is what gets registered as a webhook endpoint in the
              Stripe dashboard in order to obtain the webhook secret this form asks for below. */}
          <div className="space-y-1.5">
            <Label htmlFor="payment-webhook-url">
              {t("settings.payments.webhookUrl.label", "Webhook URL")}
            </Label>
            <div className="flex items-center gap-2">
              <Input id="payment-webhook-url" readOnly value={webhookUrl} data-cy="payment-webhook-url" />
              <Button
                variant="outline"
                size="icon"
                onClick={copyWebhookUrl}
                aria-label={t("settings.payments.actions.copy", "Copy")}
                data-cy="payment-webhook-url-copy-button"
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t(
                "settings.payments.webhookUrl.hint",
                "Register this exact URL as a webhook endpoint in your Stripe dashboard (event: checkout.session.completed), then paste the signing secret it gives you below.",
              )}
            </p>
          </div>

          {editing && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="payment-environment">
                  {t("settings.payments.fields.environment", "Environment")}
                </Label>
                <Select value={environment} onValueChange={(v) => setEnvironment(v as ChannelEnvironment)}>
                  <SelectTrigger
                    id="payment-environment"
                    className="w-full"
                    data-cy="payment-provider-stripe-environment-select"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="TEST" data-cy="payment-provider-stripe-environment-option-test">
                      {t("settings.payments.fields.environmentTest", "Test")}
                    </SelectItem>
                    <SelectItem value="PROD" data-cy="payment-provider-stripe-environment-option-prod">
                      {t("settings.payments.fields.environmentProd", "Live")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="payment-secret-key">
                  {t("settings.payments.fields.secretKey", "Secret key")}
                </Label>
                <Input
                  id="payment-secret-key"
                  type="password"
                  placeholder="sk_test_..."
                  value={secretKey}
                  onChange={(e) => setSecretKey(e.target.value)}
                  data-cy="payment-provider-stripe-secretkey-input"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="payment-webhook-secret">
                  {t("settings.payments.fields.webhookSecret", "Webhook signing secret")}
                </Label>
                <Input
                  id="payment-webhook-secret"
                  type="password"
                  placeholder="whsec_..."
                  value={webhookSecret}
                  onChange={(e) => setWebhookSecret(e.target.value)}
                  data-cy="payment-provider-stripe-webhooksecret-input"
                />
              </div>
              <div className="flex items-end justify-end gap-2 sm:col-span-2">
                {isConnected && (
                  <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                    {t("settings.payments.actions.cancel", "Cancel")}
                  </Button>
                )}
                <Button
                  size="sm"
                  onClick={handleConnect}
                  disabled={connecting}
                  data-cy="payment-provider-stripe-connect-button"
                >
                  {connecting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    t("settings.payments.actions.connect", "Connect")
                  )}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
