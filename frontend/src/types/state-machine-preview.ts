/**
 * Mirrors the compliance engine's own output types (`backend/src/compliance/engine/compliance-engine.ts`
 * `CompliancePlan`, `backend/src/compliance/lifecycle/assembler.ts` `LifecycleGraph`) as returned by
 * `GET /api/compliance/state-machine-preview`.
 *
 * Deliberately loose on the vocabulary fields (`kind`, `model`, `route`, `status`…): they are DATA
 * owned by the country profiles and the engine's own open-ended taxonomy (see `DocumentKindRule` in
 * `use-document-kinds.ts` for the same reasoning) — a build of this SPA must render a value it has
 * never seen rather than drop it. Only the shape (arrays vs single objects, required vs optional) is
 * asserted here.
 */

export type Confidence = "OFFICIAL" | "BEST_EFFORT" | "PLANNED" | "FALLBACK" | "UNVERIFIED"

export interface ObligationDeadline {
  value: number
  unit: "HOURS" | "DAYS" | "YEARS"
}

/** One duty, resolved for the synthetic operation — mirrors `ResolvedObligation`. */
export interface ResolvedObligation {
  kind: string
  layer: string
  model?: string
  blocking: boolean
  deadline: ObligationDeadline | null
  openQuestion?: string
}

/** Mirrors `PlannedArtifact`. */
export interface PlannedArtifact {
  role: string
  syntax: string
  version?: string
}

/** Mirrors `ChannelSpec`. */
export interface ChannelSpec {
  type: string
  providerId?: string
}

/** Mirrors `NumberingRule`. */
export interface NumberingRule {
  model: string
  hashChain?: boolean
  seriesScope?: string
}

/** Mirrors `CorrectionRouteRule`. */
export interface CorrectionRouteRule {
  route: string
  status: string
  transmission?: "REQUIRED" | "FORBIDDEN"
  direction?: string
  appliesTo?: string
  whenOriginalStatus?: string[]
  legalRef?: string
  openQuestion?: string
}

/** Mirrors `LifecyclePolicy`. */
export interface LifecyclePolicy {
  immutableAfter: string
  correctionModel: string
  correctionRoutes?: CorrectionRouteRule[]
  cancellation: {
    allowed: boolean
    windowHours?: number
    requiresAuthorityAck: boolean
    requiresBuyerConsent?: boolean
  }
  response?: {
    window?: { hours: number }
    defaultOnSilence?: "ACCEPT" | "NONE"
    statuses?: string[]
  }
  contingency?: { mode: string; offlineIssue: boolean; submitWithinHours: number }
}

/** Mirrors `ArchivalPolicy`. */
export interface ArchivalPolicy {
  retentionYears: number
  residency?: string
  archivedForm: string
  integrity: string
}

/** Mirrors `TaxComponent`. */
export interface TaxComponent {
  taxSystem: string
  name: string
  category: string
  rate: number
  baseMinor?: number
  reason?: string
  jurisdiction: string
  subdivision?: string
}

/** Mirrors `LegalMention`. */
export interface LegalMention {
  code: string
  text: string
}

/** Mirrors `TaxTreatment`. */
export interface TaxTreatment {
  components: TaxComponent[]
  buyerSelfAssess: boolean
  reportingFlags: string[]
  mentions: LegalMention[]
}

/** Mirrors `DocumentTaxResult`. */
export interface DocumentTaxResult {
  lines: { lineId: string; treatment: TaxTreatment }[]
  reportingFlags: string[]
  mentions: LegalMention[]
  buyerSelfAssess: boolean
}

/** Mirrors `CompliancePlan`. */
export interface CompliancePlan {
  supplier: { country: string; confidence: Confidence; delegatedFrom?: string }
  buyer: { country: string; confidence: Confidence }
  classification: { buyerRole: string; crossBorder: boolean; supplyTypes: string[] }
  tax: DocumentTaxResult
  taxSystemKind: string
  obligations: ResolvedObligation[]
  artifacts: PlannedArtifact[]
  channels: ChannelSpec[]
  reportingChannels: ChannelSpec[]
  numbering: NumberingRule
  lifecycle: LifecyclePolicy
  archival: ArchivalPolicy
  reporting: string[]
  confidence: Confidence
  warnings: string[]
}

/** Mirrors `Trigger` (lifecycle/triggers.ts). */
export interface TransitionTrigger {
  kind: string
  poll?: { everySeconds: number; timeoutHours: number; backoff: string }
  channelProviderId?: string
  correlationKey?: string
  deadlineHours?: number
  onElapse?: string
  action?: string
}

/** Mirrors `TransitionSpec`. */
export interface TransitionSpec {
  on: string
  from: string
  to: string
  trigger: TransitionTrigger
  guardKey?: string
  description?: string
}

/** Mirrors `LifecycleGraph`. */
export interface LifecycleGraph {
  initial: string
  states: string[]
  transitions: TransitionSpec[]
  profileVersion?: string
}

/** How a country code resolved — mirrors `ResolvedCountryView`. */
export interface ResolvedCountryView {
  requestedCountryCode: string
  resolvedCountryCode: string
  isFallback: boolean
  delegatedFrom?: string
  confidence: Confidence
}

/** The full response of `GET /api/compliance/state-machine-preview`. */
export interface StateMachinePreviewResponse {
  context: {
    issueDate: string
    documentKind: string
    buyerRole: string
    supplyType: string
    currency: string
  }
  supplier: ResolvedCountryView
  buyer: ResolvedCountryView
  plan: CompliancePlan
  graph: LifecycleGraph
}
