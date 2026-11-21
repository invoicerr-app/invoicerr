/** The `GET /api/company/channels` response, shared by every screen that reads it. */
import type { ChannelProvenance } from "@/components/channel-banner"
import type { ReportingObligation } from "@/pages/(app)/settings/_components/channels.declarations"

export type ChannelEnvironment = "TEST" | "PROD"
export type ChannelRequirement = "suggested" | "mandated"

export interface ConfiguredChannel {
  providerId: string
  channel: string
  environment: ChannelEnvironment
  isActive: boolean
  operatorId?: string | null
  /** Issue #527 - this ACTIVE row would be refused by the send preflight for a domestic operation,
   *  right now - see `channels.service.ts#ChannelConfigStatus.blockedBySend`'s own backend header. */
  blockedBySend?: boolean
}

export interface SuggestedChannel {
  providerId: string
  requirement?: ChannelRequirement
  mandatedFrom?: string
  effectiveNow?: boolean
  equivalentProviderIds?: string[]
  provenance: ChannelProvenance
}

/** Mirrors the backend's `LegalChannelStatus` (`channels.service.ts`) - see that interface's own
 *  header for what each field means and how it is computed. This is the settings screen's LEVEL-1
 *  nav, design C ("legal channel, then operator"). */
export interface LegalChannelStatus {
  id: string
  requirement?: ChannelRequirement
  mandatedFrom?: string
  effectiveNow?: boolean
  equivalentProviderIds?: string[]
  provenance?: ChannelProvenance
  automatic: boolean
  lawful: boolean
  mandatedElsewhere: { countryCode: string; requirement: ChannelRequirement }[]
  /** Owner review of #527 - every OTHER country whose own B2G routing runs THROUGH this channel
   *  automatically (e.g. "chorus-pro" names FR here, for every non-French company). Combined with
   *  `mandatedElsewhere` above by `channelHasHomeElsewhere` below to tell "this is specifically
   *  another country's own channel" (show "outside your invoicing country") apart from "this is a
   *  homeless, genuinely cross-border network" (Peppol - show "not accepted for your domestic
   *  invoices" instead). Mirrors the backend's `LegalChannelStatus.automaticElsewhere`. */
  automaticElsewhere: string[]
}

/** Mirrors the backend's `ChannelPolicyBanner` - design A's obligation banner, folded onto design C. */
export interface ChannelPolicyBanner {
  countryCode?: string
  tone: "mandated" | "suggested" | "none"
  legalChannelId?: string
  mandatedFrom?: string
  effectiveNow?: boolean
  provenance?: ChannelProvenance
}

export interface ChannelsResponse {
  configured: ConfiguredChannel[]
  suggested: SuggestedChannel[]
  reportingObligations: ReportingObligation[]
  legalChannels: LegalChannelStatus[]
  banner: ChannelPolicyBanner
}
