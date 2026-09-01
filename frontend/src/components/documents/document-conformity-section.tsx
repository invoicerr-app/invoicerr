import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { useDocumentAuthorityEvents } from "@/hooks/queries"
import { cn } from "@/lib/utils"

import type { DocumentAuthorityEvent } from "./types"

/**
 * Root TODO item 10's own named remainder — post-deposit conformity tracking (PDP: fr:200 déposée →
 * fr:201 émise → fr:202 reçue, or fr:213 rejetée; KSeF: gated, see the backend's own
 * `ksef-status-poller.ts`). Same mould as `document-archive-section.tsx`: shown inside the document
 * edit dialog for ANY document type/status once it has at least one event, renders NOTHING for a
 * document with zero events yet — a "sent" quote/credit-note (no transport, no poller at all) never
 * gets one, and neither does a fresh PDP deposit before the sweep's first pass. Nothing here mutates
 * `DocumentInstance.status` — the badge is a PROJECTION of this table, exactly like the backend's own
 * `DocumentAuthorityEvent` schema comment documents at length: the declared lifecycle stays the truth
 * of what THIS app did; the verdict is an external fact superposed on top of it.
 *
 * `computeConformityVerdict`/`latestConformityReason` are exported PURE functions, deliberately
 * framework-free — testable without mounting anything (`document-conformity-section.spec.tsx`), and
 * reused by `use-document-types.ts#useDocumentAuthorityEvents` to decide whether to keep polling.
 */

export type ConformityVerdict = "accepted" | "rejected" | "gaveUp" | "pending"

/** The two REAL PDP codes this session proved live (`pdp-conformity.live.spec.ts`, 2026-09-01):
 *  fr:202 ("Reçue par la plateforme") is the platform's own final ACCEPTANCE; fr:213 ("Rejetée") is
 *  its own final refusal. `pl:200`/any `pl:4xx`/`pl:5xx` mirror the SAME `{code}` convention the
 *  backend's own `ksef-status-poller.ts` borrows (gated — see that file's own honesty note). A new
 *  provider's own terminal codes are added HERE, in this one place, the same "one more entry" shape
 *  `document-status-badge.tsx`'s own `TONE_PATTERNS` already holds for an arbitrary status string. */
const ACCEPTED_CODES = new Set(["fr:202"])
const REJECTED_CODES = new Set(["fr:213"])
const KSEF_CODE = /^pl:(\d+)$/

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

/**
 * Pure — no events at all is deliberately NOT one of these four outcomes (the caller, this section
 * itself, renders nothing at all for an empty list, the same "no permanently-empty block" choice
 * `document-archive-section.tsx` already makes). Order matters: `gaveUp`/`rejected` are checked
 * before `accepted` so a document that somehow carries both a stale intermediate code and a later
 * terminal one always reads by its OWN terminal fact, never an earlier, superseded one.
 */
export function computeConformityVerdict(events: DocumentAuthorityEvent[]): ConformityVerdict {
  if (events.some((e) => e.statusCode === "poll:gave-up")) return "gaveUp"
  if (events.some((e) => isRejected(e.statusCode))) return "rejected"
  if (events.some((e) => isAccepted(e.statusCode))) return "accepted"
  return "pending"
}

/** The reason attached to the event that actually decided the verdict above — undefined unless that
 *  verdict is "rejected" (an accepted/pending event carries no "reason" in the first place; see the
 *  backend's own `DocumentAuthorityEvent.reason` schema comment). */
export function latestConformityReason(events: DocumentAuthorityEvent[]): string | undefined {
  const rejection = events.find((e) => isRejected(e.statusCode))
  return rejection?.reason ?? undefined
}

const VERDICT_TONE: Record<ConformityVerdict, string> = {
  accepted: "bg-green-100 text-green-800 dark:bg-green-950/50 dark:text-green-300",
  rejected: "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300",
  gaveUp: "bg-secondary text-secondary-foreground",
  pending: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
}

const VERDICT_LABEL_KEY: Record<ConformityVerdict, string> = {
  accepted: "documents.conformity.badge.accepted",
  rejected: "documents.conformity.badge.rejected",
  gaveUp: "documents.conformity.badge.gaveUp",
  pending: "documents.conformity.badge.pending",
}

interface ConformityBadgeProps {
  events: DocumentAuthorityEvent[]
  className?: string
  dataCySuffix?: string
}

/** A small, standalone badge — same "shared by the list AND the section, never two independent
 *  computations of the same fact" discipline `DocumentSettlementBadge` already holds. Renders nothing
 *  for an empty event list — the caller decides whether that means "not shown at all" (the section)
 *  or "no indicator on this row" (the list). */
export function ConformityBadge({ events, className, dataCySuffix }: ConformityBadgeProps) {
  const { t } = useTranslation()
  if (events.length === 0) return null
  const verdict = computeConformityVerdict(events)
  return (
    <Badge
      variant="outline"
      className={cn("border-transparent font-semibold", VERDICT_TONE[verdict], className)}
      data-cy={dataCySuffix ? `document-conformity-badge-${dataCySuffix}` : "document-conformity-badge"}
    >
      {t(VERDICT_LABEL_KEY[verdict])}
    </Badge>
  )
}

/** Shown on the document LIST — deliberately ONLY for "rejected" (this task's own brief: "un
 *  indicateur discret pour rejeté (c'est l'info qui compte)"). An accepted or still-pending deposit
 *  shows nothing on the list row at all; the full timeline (all four states) lives in the section
 *  below, inside the edit dialog. */
export function DocumentConformityListIndicator({
  typeId,
  documentId,
}: {
  typeId: string
  documentId: string
}) {
  const { data: events } = useDocumentAuthorityEvents(typeId, documentId)
  if (!events || computeConformityVerdict(events) !== "rejected") return null
  return <ConformityBadge events={events} dataCySuffix={documentId} />
}

interface ConformityTimelineProps {
  events: DocumentAuthorityEvent[]
}

/** The PRESENTATIONAL half — pure props in, markup out, no data fetching of its own. Split out from
 *  `DocumentConformitySection` below so `document-conformity-section.spec.tsx` can render it directly
 *  with hardcoded events, no query client/network mocking needed (this task's own brief: "un test de
 *  composant vitest ... avec des événements en dur"). Most-recent-first — the API's own order
 *  (`listAuthorityEvents`), never re-sorted here. */
export function ConformityTimeline({ events }: ConformityTimelineProps) {
  const { t } = useTranslation()
  return (
    <ul className="divide-y" data-cy="document-conformity-timeline">
      {events.map((event) => (
        <li
          key={event.id}
          className="space-y-1 py-2 text-sm"
          data-cy={`document-conformity-event-${event.id}`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span
              className="font-mono text-xs text-muted-foreground"
              data-cy="document-conformity-event-code"
            >
              {event.statusCode}
            </span>
            <span className="text-xs text-muted-foreground" data-cy="document-conformity-event-date">
              {new Date(event.observedAt).toLocaleString()}
            </span>
          </div>
          {event.statusText && <p data-cy="document-conformity-event-text">{event.statusText}</p>}
          {event.reason && (
            <p className="text-xs text-destructive" data-cy="document-conformity-event-reason">
              {t("documents.conformity.timeline.reason", { reason: event.reason })}
            </p>
          )}
        </li>
      ))}
    </ul>
  )
}

interface DocumentConformitySectionProps {
  typeId: string
  documentId: string
}

/** The data-fetching half, shown inside the document edit dialog (document-form.tsx), next to the
 *  archive section. Renders NOTHING for a document with no conformity events at all — never a
 *  falsely-empty "Compliance tracking" block for a document sent by email, or by any channel with no
 *  poller registered (see the backend's `authority-status-poller.ts` on why "sdi" never gets one). */
export function DocumentConformitySection({ typeId, documentId }: DocumentConformitySectionProps) {
  const { t } = useTranslation()
  const { data: events, isLoading } = useDocumentAuthorityEvents(typeId, documentId)

  if (isLoading) {
    return (
      <div className="space-y-2" data-cy="document-conformity-section">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-16 w-full" />
      </div>
    )
  }

  if (!events || events.length === 0) return null

  return (
    <div className="space-y-2 rounded-lg border p-4" data-cy="document-conformity-section">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">{t("documents.conformity.title")}</h4>
        <ConformityBadge events={events} />
      </div>
      <ConformityTimeline events={events} />
    </div>
  )
}
