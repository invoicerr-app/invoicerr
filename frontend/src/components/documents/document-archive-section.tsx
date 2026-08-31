import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useDocumentArchives, useVerifyDocumentArchive } from "@/hooks/queries"
import { cn } from "@/lib/utils"

import type { DocumentArchive } from "./types"

/**
 * Root TODO item 14 ("archivage légal ⚖") — shown inside the document edit dialog, next to the
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
              isIntact && "bg-green-100 text-green-800 dark:bg-green-950/50 dark:text-green-300",
              isCorrupted && "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300",
            )}
            data-cy={`document-archive-verify-result-${archive.id}`}
          >
            {isIntact ? t("documents.archive.resultIntact") : t("documents.archive.resultCorrupted")}
          </Badge>
        )}
      </div>

      {isCorrupted && (
        <ul
          className="space-y-1 rounded bg-red-50 p-2 dark:bg-red-950/30"
          data-cy="document-archive-corrupted-details"
        >
          {result.details.map((mismatch) => (
            <li key={mismatch.role} className="text-xs text-red-800 dark:text-red-300">
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
