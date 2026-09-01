"use client"

import { AlertTriangle } from "lucide-react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { useGet } from "@/hooks/use-fetch"
import { cn } from "@/lib/utils"
import type { Company } from "@/types"

interface ChannelProvenance {
  kind: "legal" | "unverified"
  sourceText?: string
  sourceCheckedAt?: string
}
interface ConfiguredChannel {
  providerId: string
  isActive: boolean
}
interface SuggestedChannel {
  providerId: string
  // Root TODO item 11 — see channels.settings.tsx's own comment on this exact shape.
  requirement?: "suggested" | "mandated"
  mandatedFrom?: string
  effectiveNow?: boolean
  provenance: ChannelProvenance
}
interface ChannelsResponse {
  configured: ConfiguredChannel[]
  suggested: SuggestedChannel[]
}

/** Friendly display names — same map `channels.settings.tsx` keeps for the identical reason. */
const PROVIDER_LABELS: Record<string, string> = { pdp: "PDP", ksef: "KSeF", sdi: "SdI", peppol: "Peppol" }

function sourceLine(channel: SuggestedChannel): string {
  return channel.provenance.kind === "legal" && channel.provenance.sourceText
    ? channel.provenance.sourceText
    : ""
}

/**
 * Proactive nudge — item 10 (root TODO): renders a small non-blocking banner when this company's
 * own country SUGGESTS a channel (`GET /api/company/channels`'s own `suggested`, advisory — see
 * `transports/channel-policy/schema.ts`'s header on why a mere suggestion is never a legal
 * requirement) that is not yet connected. Self-fetches, self-hides once there is nothing to
 * suggest, so it is safe to mount in multiple places (company settings, onboarding).
 *
 * Root TODO item 11 upgrades this SAME component for a channel the country actually MANDATES: once a
 * mandate is `effectiveNow` (see channels.service.ts's own header on that distinct, "as of today"
 * clock) and the company either hasn't connected it or has a DIFFERENT transport chosen, the plain
 * amber "suggested" look is replaced by a stronger, destructive-styled banner naming the channel, its
 * source, and what is currently configured instead — the state the invoice-transport picker itself
 * (`company.settings.tsx`) has no room to show inline. A mandate whose `mandatedFrom` is still in the
 * future changes NOTHING here — it stays a plain suggestion until its own date actually arrives,
 * exactly the same "issueDate, not the server's today" discipline `invoice-actions.ts`'s own preflight
 * holds, applied one clock later (this banner uses "today" because it has no invoice to anchor to —
 * see `channels.service.ts`'s own header on why that is a deliberately different question).
 */
export default function ChannelConnectPrompt({ className }: { className?: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data: channels } = useGet<ChannelsResponse>("/api/company/channels")
  const { data: company } = useGet<Company>("/api/company/info")

  const connectedIds = new Set(
    (channels?.configured ?? []).filter((c) => c.isActive).map((c) => c.providerId),
  )
  const suggested = channels?.suggested ?? []

  const activeMandate = suggested.find((s) => s.requirement === "mandated" && s.effectiveNow)
  if (activeMandate) {
    const currentTransport = company?.invoiceTransportId || undefined
    const mandateSatisfied =
      currentTransport === activeMandate.providerId && connectedIds.has(activeMandate.providerId)
    if (!mandateSatisfied) {
      const channelName = PROVIDER_LABELS[activeMandate.providerId] ?? activeMandate.providerId.toUpperCase()
      const description = connectedIds.has(activeMandate.providerId)
        ? t(
            "settings.channels.mandatePrompt.descriptionWrongTransport",
            '{{country}} requires invoices to go through {{channel}} from {{date}} — {{source}}. This company is currently set to send via "{{current}}" instead.',
            {
              country: company?.countryCode || company?.country || "",
              channel: channelName,
              date: activeMandate.mandatedFrom,
              source: sourceLine(activeMandate),
              current: currentTransport || t("settings.channels.status.notConnected", "Not connected"),
            },
          )
        : t(
            "settings.channels.mandatePrompt.descriptionNotConnected",
            "{{country}} requires invoices to go through {{channel}} from {{date}} — {{source}}. It isn't connected yet.",
            {
              country: company?.countryCode || company?.country || "",
              channel: channelName,
              date: activeMandate.mandatedFrom,
              source: sourceLine(activeMandate),
            },
          )

      return (
        <Alert variant="destructive" data-cy="channel-mandate-prompt" className={cn(className)}>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>
            {t("settings.channels.mandatePrompt.title", "E-invoicing channel required")}
          </AlertTitle>
          <AlertDescription>
            <p>{description}</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-2"
              data-cy="channel-mandate-prompt-cta"
              onClick={() => navigate("/settings/channels")}
            >
              {t("settings.channels.mandatePrompt.cta", "Connect now")}
            </Button>
          </AlertDescription>
        </Alert>
      )
    }
  }

  const actionable = suggested.filter((s) => !connectedIds.has(s.providerId))
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
