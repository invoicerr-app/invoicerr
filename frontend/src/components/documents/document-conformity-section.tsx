import { useTranslation } from "react-i18next"

import { StatusMark } from "@/components/ui/status-mark"
import { Skeleton } from "@/components/ui/skeleton"
import { useDocumentAuthorityEvents } from "@/hooks/queries/use-document-types"
import { cn } from "@/lib/utils"

import { type ConformityVerdict, computeConformityVerdict } from "./conformity-verdict"
import { SectionCard } from "./section-card"
import { type StatusPresentation, statusPresentation } from "./status-presentation"
import type { DocumentAuthorityEvent } from "./types"

/**
 * Post-deposit conformity tracking (PDP: fr:200 deposited →
 * fr:201 issued → fr:202 received, or fr:213 rejected; KSeF: gated, see the backend's own
 * `ksef-status-poller.ts`). Same mould as `document-archive-section.tsx`: shown on the document
 * detail page for ANY document type/status once it has at least one event, renders NOTHING for a
 * document with zero events yet — a "sent" quote/credit-note (no transport, no poller at all) never
 * gets one, and neither does a fresh PDP deposit before the sweep's first pass. Nothing here mutates
 * `DocumentInstance.status` — the badge is a PROJECTION of this table, exactly like the backend's own
 * `DocumentAuthorityEvent` schema comment documents at length: the declared lifecycle stays the truth
 * of what THIS app did; the verdict is an external fact superposed on top of it.
 *
 * The verdict readers themselves are in `conformity-verdict.ts`, framework-free — this file only
 * renders them.
 */

// "declarationIssue" shares the waiting mark with "pending" on purpose: the label tells them apart.
const VERDICT_MARK: Record<ConformityVerdict, StatusPresentation> = {
  accepted: statusPresentation("approved"),
  rejected: statusPresentation("rejected"),
  gaveUp: statusPresentation("cancelled"),
  pending: statusPresentation("pending"),
  declarationIssue: statusPresentation("pending"),
}

const VERDICT_LABEL_KEY: Record<ConformityVerdict, string> = {
  accepted: "documents.conformity.badge.accepted",
  rejected: "documents.conformity.badge.rejected",
  gaveUp: "documents.conformity.badge.gaveUp",
  pending: "documents.conformity.badge.pending",
  declarationIssue: "documents.conformity.badge.declarationIssue",
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
    <StatusMark
      {...VERDICT_MARK[verdict]}
      className={className}
      data-cy={dataCySuffix ? `document-conformity-badge-${dataCySuffix}` : "document-conformity-badge"}
    >
      {t(VERDICT_LABEL_KEY[verdict])}
    </StatusMark>
  )
}

/** Shown on the document LIST — deliberately ONLY for "rejected" or "declarationIssue" (a
 *  declarative-reporting failure follows the SAME discipline — see
 *  `DECLARATION_ISSUE_CODES`'s own header on why that is its own verdict, never folded into
 *  "rejected"). An accepted or still-pending deposit shows nothing on the list row at all; the full
 *  timeline (all five states) lives in the section below, on the detail page. */
export function DocumentConformityListIndicator({
  typeId,
  documentId,
}: {
  typeId: string
  documentId: string
}) {
  const { data: events } = useDocumentAuthorityEvents(typeId, documentId)
  if (!events) return null
  const verdict = computeConformityVerdict(events)
  if (verdict !== "rejected" && verdict !== "declarationIssue") return null
  return <ConformityBadge events={events} dataCySuffix={documentId} />
}

interface ConformityTimelineProps {
  events: DocumentAuthorityEvent[]
  /** When the record was created: closes the history at its bottom, below every platform event. */
  createdAt?: string
}

/** The PRESENTATIONAL half — pure props in, markup out, no data fetching of its own. Split out from
 *  `DocumentConformitySection` below so `document-conformity-section.spec.tsx` can render it directly
 *  with hardcoded events, no query client/network mocking needed. Most-recent-first — the API's own order
 *  (`listAuthorityEvents`), never re-sorted here. */
export function ConformityTimeline({ events, createdAt }: ConformityTimelineProps) {
  const { t } = useTranslation()
  return (
    <ol className="relative" data-cy="document-conformity-timeline">
      {events.map((event, index) => {
        const presentation = statusPresentation(event.reason ? "rejected" : event.statusCode)
        return (
          <li
            key={event.id}
            className="relative grid grid-cols-[1rem_1fr] gap-x-3 pb-4 text-sm last:pb-0"
            data-cy={`document-conformity-event-${event.id}`}
          >
            {(index < events.length - 1 || createdAt) && (
              <span aria-hidden="true" className="absolute start-[7px] top-4 bottom-0 w-px bg-border" />
            )}
            <StatusMark {...presentation} className="mt-0.5 gap-0" aria-hidden="true" />
            <div className="min-w-0 space-y-0.5">
              <p
                className={cn("font-semibold", event.reason && "text-destructive-soft-foreground")}
                data-cy="document-conformity-event-text"
              >
                {event.statusText || t("documents.conformity.timeline.statusUpdate")}
              </p>
              <p className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                {/* The platform's own code stays out of sight: the person reads the label above. */}
                <span hidden data-cy="document-conformity-event-code">
                  {event.statusCode}
                </span>
                <span className="tabular-nums" data-cy="document-conformity-event-date">
                  {new Date(event.observedAt).toLocaleString()}
                </span>
              </p>
              {event.reason && (
                <p
                  className="text-xs text-destructive-soft-foreground"
                  data-cy="document-conformity-event-reason"
                >
                  {t("documents.conformity.timeline.reason", { reason: event.reason })}
                </p>
              )}
            </div>
          </li>
        )
      })}
      {createdAt && (
        <li
          className="relative grid grid-cols-[1rem_1fr] gap-x-3 text-sm"
          data-cy="document-conformity-created"
        >
          <StatusMark {...statusPresentation("draft")} className="mt-0.5 gap-0" aria-hidden="true" />
          <div className="min-w-0 space-y-0.5">
            <p className="font-semibold">{t("documents.conformity.timeline.created")}</p>
            <p className="text-xs tabular-nums text-muted-foreground">
              {new Date(createdAt).toLocaleString()}
            </p>
          </div>
        </li>
      )}
    </ol>
  )
}

interface DocumentConformitySectionProps {
  typeId: string
  documentId: string
  createdAt?: string
}

/** The data-fetching half, shown on the document detail page (document-detail.tsx), next to the
 *  archive section. Renders NOTHING for a document with no conformity events at all — never a
 *  falsely-empty "Compliance tracking" block for a document sent by email, or by any channel with no
 *  poller registered (see the backend's `authority-status-poller.ts` on why "sdi" never gets one). */
export function DocumentConformitySection({ typeId, documentId, createdAt }: DocumentConformitySectionProps) {
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
    <SectionCard
      title={t("documents.conformity.title")}
      aside={<ConformityBadge events={events} />}
      dataCy="document-conformity-section"
    >
      <ConformityTimeline events={events} createdAt={createdAt} />
    </SectionCard>
  )
}
