"use client"

import { AlertTriangle } from "lucide-react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router"

import {
  type ChannelProvenance,
  ChannelBannerSource,
  countryName,
  formatMandateDate,
  legalChannelLabel,
} from "@/components/channel-banner"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { useGet } from "@/hooks/use-fetch"
import { cn } from "@/lib/utils"
import type { Company } from "@/types"

interface ConfiguredChannel {
  providerId: string
  isActive: boolean
}
interface SuggestedChannel {
  providerId: string
  // See channels.settings.tsx's own comment on this exact shape.
  requirement?: "suggested" | "mandated"
  mandatedFrom?: string
  effectiveNow?: boolean
  provenance: ChannelProvenance
}
interface ChannelsResponse {
  configured: ConfiguredChannel[]
  suggested: SuggestedChannel[]
}

/** Friendly display names for the "suggested, not yet connected" case below, which names possibly
 *  several channels in one short sentence rather than one full legal-channel label each -
 *  `legalChannelLabel` (shared with `channels.settings.tsx`'s own banner) is used for the single
 *  named channel in the mandated case instead, where the full label reads better. */
const PROVIDER_LABELS: Record<string, string> = { pdp: "PDP", ksef: "KSeF", sdi: "SdI" }

/**
 * Proactive nudge: renders a small non-blocking banner when this company's
 * own country SUGGESTS a channel (`GET /api/company/channels`'s own `suggested`, advisory, see
 * `transports/channel-policy/schema.ts`'s header on why a mere suggestion is never a legal
 * requirement) that is not yet connected. Self-fetches, self-hides once there is nothing to
 * suggest, so it is safe to mount in multiple places (company settings, onboarding).
 *
 * The SAME component is upgraded for a channel the country actually MANDATES: once a
 * mandate is `effectiveNow` (see channels.service.ts's own header on that distinct, "as of today"
 * clock) and the company either hasn't connected it or has a DIFFERENT transport chosen, the plain
 * amber "suggested" look is replaced by this same warning-weight banner naming the channel and what
 * is currently configured instead (never `variant="destructive"`, same owner review as
 * `channels.settings.tsx`'s own `ChannelBanner`: this is not an error the user caused), one plain
 * sentence with the statute quote collapsed behind `ChannelBannerSource`'s "Read the source" rather
 * than spliced into the sentence itself. This is the state the invoice-transport picker itself
 * (`company.settings.tsx`) has no room to show inline. A mandate whose `mandatedFrom` is still in the
 * future changes NOTHING here, it stays a plain suggestion until its own date actually arrives,
 * exactly the same "issueDate, not the server's today" discipline `invoice-actions.ts`'s own preflight
 * holds, applied one clock later (this banner uses "today" because it has no invoice to anchor to,
 * see `channels.service.ts`'s own header on why that is a deliberately different question).
 */
export default function ChannelConnectPrompt({ className }: { className?: string }) {
  const { t, i18n } = useTranslation()
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
      // Same formatting as `channels.settings.tsx`'s own `ChannelBanner` (issue #543, owner review):
      // the reader's own language for the country and the date, the full legal-channel label rather
      // than a bare provider id, and the raw statute quote moved into `ChannelBannerSource`'s
      // collapsed "Read the source" instead of spliced into the sentence itself.
      const country = countryName(i18n.language, company?.countryCode || company?.country)
      const channel = legalChannelLabel(t, activeMandate.providerId)
      const date = formatMandateDate(i18n.language, activeMandate.mandatedFrom)
      const description = connectedIds.has(activeMandate.providerId)
        ? t(
            "settings.channels.mandatePrompt.descriptionWrongTransport",
            'Since {{date}}, your invoices from {{country}} must go through {{channel}}. This company is currently set to send via "{{current}}" instead.',
            {
              country,
              channel,
              date,
              current: currentTransport || t("settings.channels.status.notConnected", "Not connected"),
            },
          )
        : t(
            "settings.channels.mandatePrompt.descriptionNotConnected",
            "Since {{date}}, your invoices from {{country}} must go through {{channel}}. It isn't connected yet.",
            { country, channel, date },
          )

      return (
        <Alert variant="warning" data-cy="channel-mandate-prompt" className={cn(className)}>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>
            {t("settings.channels.mandatePrompt.title", "E-invoicing channel required")}
          </AlertTitle>
          <AlertDescription>
            <p>{description}</p>
            <ChannelBannerSource provenance={activeMandate.provenance} t={t} />
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
      className={cn("border-warning-foreground/30 bg-warning", className)}
    >
      <AlertTriangle className="h-4 w-4 text-warning-foreground" />
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
