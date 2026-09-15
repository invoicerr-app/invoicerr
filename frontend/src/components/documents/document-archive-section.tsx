import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useDocumentArchives, useVerifyDocumentArchive } from "@/hooks/queries"
import { cn } from "@/lib/utils"

import type { DocumentArchive } from "./types"

/**
 * Legal archiving ⚖ — shown inside the document edit dialog, next to the
 * settlement section (document-settlement.tsx), for ANY document type that has at least one archive:
 * nothing here names "invoice" — a quote sent by email archives its own PDF exactly the same way.
 * Renders NOTHING at all for a document with zero archives yet (a draft, or a type whose "send"
 * delivers no conservable artifact — e.g. the credit note's own plain status transition, see the
 * backend's `credit-note-actions.ts`) — same "no permanently-empty block" choice
 * `document-settlement.tsx`'s own credits block already makes.
 */

function abbreviateHash(hash: string): string {
  return `${hash.slice(0, 12)}…`
}

/**
 * True when `retentionUntil` is shown as a real date but this row predates the backend's
 * `retentionCalcVersion` column (`schema.prisma`) — meaning it may have been computed by the
 * pre-`cf2e7323` bug that counted every retention duration from the archiving instant instead of the
 * statute's own origin, up to a year too EARLY (see the backend's `archive/retention/
 * compute-retention.ts` and `calc-version.ts`). Exported for the same "pure logic, unit-tested
 * separately from render" split `document-conformity-section.tsx#computeConformityVerdict` already
 * uses in this module.
 *
 * Deliberately conservative: a null `retentionUntil` (no declared rule for that country) is NEVER
 * flagged — the OLD and NEW algorithms produce the exact same honest "no duration" text in that case
 * (see `calc-version.ts`'s own header), so there is nothing stale to warn about, and a document with
 * no retention date has no "too early" reading to correct in the first place.
 */
export function isRetentionCalcStale(
  archive: Pick<DocumentArchive, "retentionUntil" | "retentionCalcVersion">,
): boolean {
  return archive.retentionUntil !== null && archive.retentionCalcVersion === null
}

interface DocumentArchiveRowProps {
  typeId: string
  documentId: string
  archive: DocumentArchive
}

function DocumentArchiveRow({ typeId, documentId, archive }: DocumentArchiveRowProps) {
  const { t } = useTranslation()
  const verify = useVerifyDocumentArchive()

  const result = verify.data
  const isIntact = result?.status === "intact"
  const isCorrupted = result?.status === "corrupted"

  return (
    <li className="space-y-2 py-3" data-cy={`document-archive-${archive.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="font-mono text-muted-foreground" data-cy="document-archive-hash">
          {abbreviateHash(archive.contentHash)}
        </span>
        <span className="text-muted-foreground" data-cy="document-archive-date">
          {new Date(archive.archivedAt).toLocaleString()}
        </span>
      </div>

      <p className="text-xs text-muted-foreground" data-cy="document-archive-retention">
        {archive.retentionUntil
          ? t("documents.archive.retentionUntil", {
              date: new Date(archive.retentionUntil).toLocaleDateString(),
              basis: archive.retentionBasis,
            })
          : t("documents.archive.retentionNone", { basis: archive.retentionBasis })}
      </p>

      {isRetentionCalcStale(archive) && (
        <p
          className="rounded bg-warning p-2 text-xs text-warning-foreground"
          data-cy="document-archive-retention-stale"
        >
          {/* No date is interpolated on purpose. The only date this row holds IS the suspect one,
              already rendered just above — repeating it inside a sentence that says "keep it at
              least until …" would name the too-early value as the safe floor, which is the exact
              mistake the notice exists to warn about. Nothing here can compute the corrected date:
              that would mean recomputing the row, which is refused (see the backend's
              `archive/retention/calc-version.ts`). */}
          {t("documents.archive.retentionStale")}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          loading={verify.isPending}
          onClick={() => verify.mutate({ typeId, documentId, archiveId: archive.id })}
          dataCy={`document-archive-verify-${archive.id}`}
        >
          {t("documents.archive.verify")}
        </Button>

        {result && (
          <Badge
            variant="outline"
            className={cn(
              "border-transparent font-semibold",
              isIntact && "bg-success text-success-foreground",
              isCorrupted && "bg-destructive-soft text-destructive-soft-foreground",
            )}
            data-cy={`document-archive-verify-result-${archive.id}`}
          >
            {isIntact ? t("documents.archive.resultIntact") : t("documents.archive.resultCorrupted")}
          </Badge>
        )}
      </div>

      {isCorrupted && (
        <ul
          className="space-y-1 rounded bg-destructive-soft p-2"
          data-cy="document-archive-corrupted-details"
        >
          {result.details.map((mismatch) => (
            <li key={mismatch.role} className="text-xs text-destructive-soft-foreground">
              {t("documents.archive.corruptedDetail", {
                role: mismatch.role,
                expected: mismatch.expected,
                actual: mismatch.actual ?? t("documents.archive.corruptedMissing"),
              })}
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

interface DocumentArchiveSectionProps {
  typeId: string
  documentId: string
}

export function DocumentArchiveSection({ typeId, documentId }: DocumentArchiveSectionProps) {
  const { t } = useTranslation()
  const { data: archives, isLoading } = useDocumentArchives(typeId, documentId)

  if (isLoading) {
    return (
      <div className="space-y-2" data-cy="document-archive-section">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-16 w-full" />
      </div>
    )
  }

  // Never a permanently-empty block for a document (or type) that has no archive at all — same
  // choice `document-settlement.tsx`'s own credits block already makes.
  if (!archives || archives.length === 0) return null

  return (
    <div className="space-y-2 rounded-lg border p-4" data-cy="document-archive-section">
      <h4 className="text-sm font-semibold">{t("documents.archive.title")}</h4>
      <ul className="divide-y" data-cy="document-archive-list">
        {archives.map((archive) => (
          <DocumentArchiveRow key={archive.id} typeId={typeId} documentId={documentId} archive={archive} />
        ))}
      </ul>
    </div>
  )
}
