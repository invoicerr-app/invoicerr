import { CheckCircle2, MessageSquareText } from "lucide-react"
import { useTranslation } from "react-i18next"

import { useDocumentManualAcceptance } from "@/hooks/queries"

import { SectionCard } from "./section-card"

interface DocumentAcceptanceSectionProps {
  typeId: string
  documentId: string
  /** The record's own LIVE status (`document-detail.tsx`'s `liveInstance.status`) - this section
   *  renders NOTHING for any status other than "signed"/"accepted" (issue #421's own two ways a
   *  quote can be accepted). Read here rather than the section fetching its own status: the caller
   *  already has it live, and a second, independent read of the SAME fact could disagree with it for
   *  a moment right after an action runs. */
  status: string
  /** The record's own `updatedAt` (ISO) - see this file's own header on why an e-signature's own
   *  timestamp is read off it rather than a dedicated endpoint. */
  updatedAt: string
}

/**
 * Issue #421: the ONE place a company can see WHICH of the two ways a quote was accepted actually
 * happened, worded so neither can be mistaken for the other - never "Signed" for a manual entry,
 * never "Accepted manually" for a real e-signature. Renders NOTHING for any other status (a draft, a
 * merely "sent" quote awaiting a response, "refused") - same "no permanently-empty block" choice
 * `document-archive-section.tsx`/`document-conformity-section.tsx` already make.
 *
 * ## Why the e-signature side reads `updatedAt`, not a dedicated endpoint
 *
 * `signatures/signatures.service.ts#markSigned` writes "signed" as a STATUS-ONLY update
 * (`updateDocumentStatus`, never touching `data`) and nothing else on the document row afterwards -
 * the exact same fact `actions/quote-manual-acceptance.ts`'s own header leans on for why manual
 * acceptance is ALSO a pure status write. `updatedAt` is therefore, provably, the instant that
 * status commit happened: no code path updates a "signed" quote's row again afterward (the record
 * is effectively terminal from the issuer's own side). Building a whole extra authenticated endpoint
 * to re-derive the SAME timestamp off the `Signature` table would duplicate a fact this column
 * already carries exactly, for a screen that only ever shows it approximately (`toLocaleString`) -
 * see this feature's own PR for the (deliberate, scope-bounded) call not to add one.
 */
export function DocumentAcceptanceSection({
  typeId,
  documentId,
  status,
  updatedAt,
}: DocumentAcceptanceSectionProps) {
  const { t } = useTranslation()
  const isManual = status === "accepted"
  const isSigned = status === "signed"
  // Fetched even when `isSigned` (never displayed then) so a company that FIRST accepted manually,
  // was somehow later e-signed by some other path, still only ever shows ONE card - the query is
  // cheap (`enabled` below) and the render below is what actually decides which one wins, never a
  // stale manual record surviving next to a fresher signed one.
  const { data: manual, isLoading } = useDocumentManualAcceptance(typeId, documentId)

  if (!isManual && !isSigned) return null
  if (isManual && isLoading) return null
  if (isManual && !manual) return null

  return (
    <SectionCard title={t("documents.acceptance.sectionTitle")} dataCy="document-acceptance-section">
      {isManual && manual && (
        <div
          className="flex items-start gap-3 rounded-md bg-warning/10 p-3"
          data-cy="document-acceptance-manual"
        >
          <MessageSquareText className="mt-0.5 size-5 shrink-0 text-warning-foreground" aria-hidden="true" />
          <div className="space-y-1 text-sm">
            <p className="font-medium" data-cy="document-acceptance-manual-label">
              {t("documents.acceptance.manualLabel")}
            </p>
            <p className="text-muted-foreground" data-cy="document-acceptance-manual-entry">
              {t("documents.acceptance.manualEntry", { actorName: manual.actorName, note: manual.note })}
            </p>
            <p className="text-xs text-muted-foreground">{new Date(manual.acceptedAt).toLocaleString()}</p>
          </div>
        </div>
      )}

      {isSigned && (
        <div
          className="flex items-start gap-3 rounded-md bg-success/10 p-3"
          data-cy="document-acceptance-signed"
        >
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success-foreground" aria-hidden="true" />
          <div className="space-y-1 text-sm">
            <p className="font-medium" data-cy="document-acceptance-signed-label">
              {t("documents.acceptance.signedLabel")}
            </p>
            <p className="text-muted-foreground" data-cy="document-acceptance-signed-entry">
              {t("documents.acceptance.signedEntry", { date: new Date(updatedAt).toLocaleString() })}
            </p>
          </div>
        </div>
      )}
    </SectionCard>
  )
}
