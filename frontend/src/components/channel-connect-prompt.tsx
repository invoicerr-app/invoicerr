"use client"

import { AlertTriangle } from "lucide-react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { useGet } from "@/hooks/use-fetch"
import { cn } from "@/lib/utils"

interface ChannelProvenance {
  kind: "legal" | "unverified"
}
interface ConfiguredChannel {
  providerId: string
  isActive: boolean
}
interface SuggestedChannel {
  providerId: string
  provenance: ChannelProvenance
}
interface ChannelsResponse {
  configured: ConfiguredChannel[]
  suggested: SuggestedChannel[]
}

/** Friendly display names — same map `channels.settings.tsx` keeps for the identical reason. */
const PROVIDER_LABELS: Record<string, string> = { pdp: "PDP", ksef: "KSeF", sdi: "SdI" }

/**
 * Proactive nudge — item 10 (root TODO): renders a small non-blocking banner when this company's
 * own country SUGGESTS a channel (`GET /api/company/channels`'s own `suggested`, advisory — see
 * `transports/channel-suggestion/schema.ts`'s header on why this is never a legal requirement) that
 * is not yet connected. Self-fetches, self-hides once there is nothing to suggest, so it is safe to
 * mount in multiple places (company settings, onboarding).
 */
export default function ChannelConnectPrompt({ className }: { className?: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data: channels } = useGet<ChannelsResponse>("/api/company/channels")

  const connectedIds = new Set(
    (channels?.configured ?? []).filter((c) => c.isActive).map((c) => c.providerId),
  )
  const actionable = (channels?.suggested ?? []).filter((s) => !connectedIds.has(s.providerId))

  if (actionable.length === 0) return null

  const channelNames = actionable
    .map((s) => PROVIDER_LABELS[s.providerId] ?? s.providerId.toUpperCase())
    .join(", ")

  return (
    <Alert
      data-cy="channel-connect-prompt"
      className={cn("border-amber-300 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20", className)}
    >
      <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-500" />
      <AlertTitle>{t("settings.channels.prompt.title", "E-invoicing channel suggested")}</AlertTitle>
      <AlertDescription>
        <p>
          {t(
            "settings.channels.prompt.description",
            "Your country's usual channel — {{channels}} — isn't connected yet.",
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
