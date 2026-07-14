"use client"

import { AlertTriangle } from "lucide-react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { useCompany } from "@/hooks/queries/use-company"
import { useGet } from "@/hooks/use-fetch"
import { cn } from "@/lib/utils"

/** Mirrors backend ProviderMaturity (transmission-provider.ts). Undefined/unknown ⇒ treat as STUB. */
type ProviderMaturity = "PROVEN" | "IMPLEMENTED" | "STUB"

interface ProviderMeta {
  id: string
  channel: string
  feedback: string
  configSchema: { fields: any[] } | null
  /** F-8/M-16: a STUB provider has no real transport — never offer a working Connect control for it. */
  maturity?: ProviderMaturity
}

interface RequiredChannel {
  type: string
  providerId: string
  provider: ProviderMeta | null
  isConfigured: boolean
  environment: string | null
  config: Record<string, unknown> | null
  /** ISO date string — when this channel mandate starts. Future dates = "coming soon". */
  availableFrom?: string
}

/** Friendly display names for known providerIds. Falls back to the provider's raw channel/id. */
const CHANNEL_LABELS: Record<string, string> = {
  ksef: "KSeF",
  pdp: "PDP",
  superpdp: "PDP",
  sdi: "SdI",
  peppol: "Peppol",
}

function friendlyChannelName(ch: RequiredChannel): string {
  return CHANNEL_LABELS[ch.providerId.toLowerCase()] ?? ch.provider?.channel ?? ch.providerId
}

/**
 * Proactive nudge for e-invoicing compliance: renders a small non-blocking
 * banner when the company has at least one required transmission channel
 * that is actionable right now (live mandate, real — not STUB — provider)
 * but not yet connected. Self-fetches, self-hides (renders nothing) once
 * there's nothing actionable left, so it's safe to mount in multiple places.
 *
 * Show condition mirrors the honesty rule already enforced in
 * channels.settings.tsx (F-8/M-16): a STUB provider can't really transmit,
 * so it must never trigger this nudge.
 */
export default function ChannelConnectPrompt({ className }: { className?: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data: company } = useCompany()
  const companyId = company?.id

  const { data: requiredChannels } = useGet<RequiredChannel[]>(
    companyId ? `/api/compliance/channels/companies/${companyId}/required-channels` : null,
  )

  const now = Date.now()
  const actionable = (requiredChannels ?? []).filter((ch) => {
    const maturity = ch.provider?.maturity
    const isLiveProvider = maturity === "PROVEN" || maturity === "IMPLEMENTED"
    const isLiveMandate = !ch.availableFrom || new Date(ch.availableFrom).getTime() <= now
    return isLiveProvider && !ch.isConfigured && isLiveMandate
  })

  if (actionable.length === 0) return null

  const channelNames = actionable.map(friendlyChannelName).join(", ")

  return (
    <Alert
      data-cy="channel-connect-prompt"
      className={cn("border-amber-300 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20", className)}
    >
      <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-500" />
      <AlertTitle>{t("settings.channels.prompt.title", "E-invoicing channel required")}</AlertTitle>
      <AlertDescription>
        <p>
          {t(
            "settings.channels.prompt.description",
            "Your country requires connecting {{channels}} to send compliant invoices.",
            { channels: channelNames },
          )}
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-2"
          data-cy="channel-connect-prompt-cta"
          onClick={() => navigate("/settings/channels")}
        >
          {t("settings.channels.prompt.cta", "Connect now")}
        </Button>
      </AlertDescription>
    </Alert>
  )
}
