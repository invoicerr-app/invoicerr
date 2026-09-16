import { useTranslation } from "react-i18next"
import { useParams } from "react-router"

import { PublicPageShell } from "@/components/public-page-shell"
import { Skeleton } from "@/components/ui/skeleton"
import { useLegalDocuments } from "@/hooks/queries"
import { LEGAL_CONTENT_CLASSNAME, LegalMarkdown } from "@/lib/legal-markdown"

/**
 * Public `/legal/:slug` — one of the five documents `GET /api/legal/documents` serves (Terms of
 * Service, Privacy Policy, Data Processing Agreement, Legal Notice, Cookies & Acceptable Use).
 * Reachable with no session, on every instance (self-hosted included — this route never depends on
 * `WARNING__ENABLE_BILLING_FOR_USERS__WARNING`, unlike the sign-up checkbox these same documents also
 * back). Shares `PublicPageShell` with the client portal and the signature page — the one frame every
 * public, no-session page in this app renders through.
 */
export default function LegalDocumentPage() {
  const { t } = useTranslation()
  const { slug = "" } = useParams()
  const { data, isPending, isError } = useLegalDocuments()
  const doc = data?.documents.find((d) => d.slug === slug)

  return (
    <PublicPageShell width="narrow" dataCy="legal-document-page">
      <div className="space-y-4 pb-16">
        {isPending && (
          <div className="space-y-3" data-cy="legal-document-loading">
            <Skeleton className="h-7 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        )}

        {!isPending && (isError || !doc) && (
          <p className="text-muted-foreground" data-cy="legal-document-not-found">
            {t("legal.document.notFound", "This document could not be found.")}
          </p>
        )}

        {doc && (
          <article data-cy="legal-document-content">
            <h1 className="font-heading text-2xl font-semibold tracking-tight">{doc.title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("legal.document.version", "Version {{version}} — effective {{date}}", {
                version: doc.version,
                date: doc.effectiveDate,
              })}
            </p>
            <LegalMarkdown content={doc.content} className={`mt-6 ${LEGAL_CONTENT_CLASSNAME}`} />
          </article>
        )}
      </div>
    </PublicPageShell>
  )
}
