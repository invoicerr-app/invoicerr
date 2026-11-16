"use client"

import type { TFunction } from "i18next"

import { ProseHelp } from "@/components/ui/prose-help"

/** Mirrors the backend's `ChannelProvenance` (`transports/channel-policy/schema.ts`) - a legal fact
 *  quotes its exact source text, an unverified one carries a resolution note instead. Shared between
 *  every screen that renders a channel obligation banner, so there is one definition of what
 *  "provenance" means on the frontend, not one per caller. */
export interface ChannelProvenance {
  kind: "legal" | "unverified"
  resolutionNote?: string
  sourceText?: string
  sourceCheckedAt?: string
}

/** Display label DEFAULTS for a legal channel id (`documents/operators/schema.ts#OperatorOffering.
 *  legalChannel`) - every string still goes through `t()` (issue #527's own instruction), this is
 *  only the English fallback + translation key stem. A channel this map has no opinion about (a
 *  future legal channel the operator catalogue grows) falls back to its bare, upper-cased id. */
const LEGAL_CHANNEL_LABEL_DEFAULTS: Record<string, string> = {
  pdp: "Accredited platform (PA)",
  sdi: "Sistema di Interscambio (SdI)",
  ksef: "KSeF",
  "chorus-pro": "Chorus Pro",
  peppol: "Peppol",
}

export function legalChannelLabel(t: TFunction, id: string): string {
  return t(`settings.channels.legal.${id}.label`, LEGAL_CHANNEL_LABEL_DEFAULTS[id] ?? id.toUpperCase())
}

/** A human-readable country name from an ISO 3166-1 alpha-2 code, in the reader's own language -
 *  same `Intl.DisplayNames` convention `lib/apply-address-suggestion.ts` already uses; never a legal
 *  fact, purely a display nicety over a code the backend already resolved. */
export function countryName(language: string, code?: string): string {
  if (!code) return ""
  try {
    return new Intl.DisplayNames([language, "en"], { type: "region" }).of(code) ?? code
  } catch {
    return code
  }
}

/** A `YYYY-MM-DD` mandate date, spelled out in the reader's own language (e.g. "1 September 2026") -
 *  owner review of #527: the banner used to interpolate the raw ISO string into a sentence, which
 *  reads fine in a table cell but not in prose. Falls back to the raw string if it does not parse -
 *  never throws, never blanks a date the backend did send. */
export function formatMandateDate(language: string, isoDate?: string): string {
  if (!isoDate) return ""
  const parsed = new Date(`${isoDate}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return isoDate
  try {
    return new Intl.DateTimeFormat(language, { day: "numeric", month: "long", year: "numeric" }).format(
      parsed,
    )
  } catch {
    return isoDate
  }
}

// The statute quote (or, for an unverified fact, its resolution note) behind a `?`, never in the banner itself.
export function ChannelBannerSource({ provenance, t }: { provenance?: ChannelProvenance; t: TFunction }) {
  if (!provenance) return null
  return (
    <ProseHelp
      title={
        provenance.kind === "legal"
          ? t("settings.channels.banner.source", "Legal source")
          : t("settings.channels.banner.unverifiedSource", "Not yet verified")
      }
      dataCy="channels-banner-source"
      className="mt-1 text-sm text-current"
    >
      {provenance.kind === "legal" ? provenance.sourceText : provenance.resolutionNote}
    </ProseHelp>
  )
}
