import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useParams } from "react-router"

import { LegalLanguageSelect } from "@/components/legal-language-select"
import { PublicPageShell } from "@/components/public-page-shell"
import { Skeleton } from "@/components/ui/skeleton"
import { useLegalDocuments } from "@/hooks/queries"
import { LEGAL_CONTENT_CLASSNAME, LegalMarkdown } from "@/lib/legal-markdown"

/**
 * Public `/legal/:slug` — one of the six documents `GET /api/legal/documents` serves (Terms of
 * Service, Privacy Policy, Data Processing Agreement, Legal Notice, Cookies & Acceptable Use,
 * International Access Transparency).
 * Reachable with no session, on every instance (self-hosted included — this route never depends on
 * `WARNING__ENABLE_BILLING_FOR_USERS__WARNING`, unlike the sign-up checkbox these same documents also
 * back). Shares `PublicPageShell` with the client portal and the signature page — the one frame every
 * public, no-session page in this app renders through.
 *
 * With no explicit `langOverride`, the backend resolves this visitor's own language on its own
 * (account locale, then `Accept-Language`, then English — `legal-request-language.ts`) — the
 * `LegalLanguageSelect` below only ever appears once `doc.availableLanguages` proves this particular
 * slug actually has more than one, and picking one re-fetches with an explicit `?lang=` that outranks
 * every server-side signal.
 */
export default function LegalDocumentPage() {
  const { t } = useTranslation()
  const { slug = "" } = useParams()
  const [langOverride, setLangOverride] = useState<string | undefined>(undefined)
  const { data, isPending, isError } = useLegalDocuments(langOverride)
  const doc = data?.documents.find((d) => d.slug === slug)
  // `saasMode` (mirroring the backend's own billing flag) is also this endpoint's own signal for
  // "self-hosted, and therefore an intentionally empty catalogue" — see `legal.service.ts#listDocuments`.
  // A bookmark or a link from the operator's own site must not land on a page that just looks broken:
  // this distinguishes that case (every slug 404s the same way) from an ordinary bad slug on a hosted
  // instance that DOES publish documents, which keeps the plain "not found" wording for that case.
  const notAvailableSelfHosted = !isPending && !isError && !doc && data?.saasMode === false

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
            {notAvailableSelfHosted
              ? t(
                  "legal.document.notAvailableSelfHosted",
                  "This instance doesn't publish this document — it applies to the hosted service only. " +
                    "Self-hosted software is covered by its own license, not by these terms.",
                )
              : t("legal.document.notFound", "This document could not be found.")}
          </p>
        )}

        {doc && (
          <article data-cy="legal-document-content">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h1 className="font-heading text-2xl font-semibold tracking-tight">{doc.title}</h1>
              <LegalLanguageSelect
                value={doc.language}
                languages={doc.availableLanguages}
                onChange={setLangOverride}
              />
            </div>
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
