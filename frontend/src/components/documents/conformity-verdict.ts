import type { DocumentAuthorityEvent } from "./types"

/**
 * The five outcomes of post-deposit conformity tracking, and the two PURE readers every consumer
 * (the section, the list indicator, and `use-document-types.ts#useDocumentAuthorityEvents`'s polling
 * decision) computes from. Framework-free on purpose: it lives apart from the React section so a
 * data hook never has to import a component module.
 */

export type ConformityVerdict = "accepted" | "rejected" | "gaveUp" | "pending" | "declarationIssue"

/** The two REAL PDP codes proved live (`superpdp-conformity.live.spec.ts`, 2026-09-01):
 *  fr:202 ("Received by the platform") is the platform's own final ACCEPTANCE; fr:213 ("Rejected") is
 *  its own final refusal. `pl:200`/any `pl:4xx`/`pl:5xx` mirror the SAME `{code}` convention the
 *  backend's own `ksef-status-poller.ts` borrows (gated — see that file's own honesty note). A new
 *  provider's own terminal codes are added HERE, in this one place, the same "one more entry" shape
 *  `document-status-badge.tsx`'s own `TONE_PATTERNS` already holds for an arbitrary status string. */
const ACCEPTED_CODES = new Set(["fr:202"])
const REJECTED_CODES = new Set(["fr:213"])
const KSEF_CODE = /^pl:(\d+)$/

/** `reporting/report-job.ts`'s own two synthetic codes. DELIBERATELY a
 *  verdict of its OWN, never folded into `rejected`: a declaration failure/block says NOTHING about
 *  the invoice itself (it already left — see `reporting/report-on-send.ts`'s own header) — labeling
 *  it "Rejected" would falsely imply the INVOICE was refused, when only its post-issuance DATA
 *  REPORT to a tax authority has a problem. Still shown on the document LIST (same as a real
 *  rejection — see `DocumentConformityListIndicator` in the section) because it is exactly the kind
 *  of thing a company needs to notice and act on, same "never silent" principle as a rejection. */
const DECLARATION_ISSUE_CODES = new Set(["report:blocked", "report:failed"])

function isAccepted(code: string): boolean {
  if (ACCEPTED_CODES.has(code)) return true
  const ksef = KSEF_CODE.exec(code)
  return ksef ? Number(ksef[1]) === 200 : false
}

function isRejected(code: string): boolean {
  if (REJECTED_CODES.has(code)) return true
  const ksef = KSEF_CODE.exec(code)
  return ksef ? Number(ksef[1]) >= 400 : false
}

function isDeclarationIssue(code: string): boolean {
  return DECLARATION_ISSUE_CODES.has(code)
}

/**
 * Pure — no events at all is deliberately NOT one of these five outcomes (the caller, the section
 * itself, renders nothing at all for an empty list, the same "no permanently-empty block" choice
 * `document-archive-section.tsx` already makes). Order matters: `gaveUp`/`declarationIssue`/`rejected`
 * are checked before `accepted` so a document that somehow carries both a stale intermediate code and
 * a later terminal one always reads by its OWN terminal fact, never an earlier, superseded one.
 */
export function computeConformityVerdict(events: DocumentAuthorityEvent[]): ConformityVerdict {
  if (events.some((e) => e.statusCode === "poll:gave-up")) return "gaveUp"
  if (events.some((e) => isDeclarationIssue(e.statusCode))) return "declarationIssue"
  if (events.some((e) => isRejected(e.statusCode))) return "rejected"
  if (events.some((e) => isAccepted(e.statusCode))) return "accepted"
  return "pending"
}

/** The reason attached to the event that actually decided the verdict above — undefined unless that
 *  verdict is "rejected"/"declarationIssue" (an accepted/pending event carries no "reason" in the
 *  first place; see the backend's own `DocumentAuthorityEvent.reason` schema comment). Declaration
 *  issues checked FIRST, mirroring `computeConformityVerdict`'s own precedence just above. */
export function latestConformityReason(events: DocumentAuthorityEvent[]): string | undefined {
  const declarationIssue = events.find((e) => isDeclarationIssue(e.statusCode))
  if (declarationIssue) return declarationIssue.reason ?? undefined
  const rejection = events.find((e) => isRejected(e.statusCode))
  return rejection?.reason ?? undefined
}
