import { useTranslation } from "react-i18next"
import { Navigate } from "react-router"

import { PublicPageShell } from "@/components/public-page-shell"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useAcceptLegal, useLegalDocuments, useLegalStatus } from "@/hooks/queries"
import { authClient } from "@/lib/auth"
import { LEGAL_CONTENT_CLASSNAME, LegalMarkdown } from "@/lib/legal-markdown"

/**
 * `/legal/accept` — the SaaS-mode re-acceptance interstitial: a signed-in user whose account still
 * carries an OLDER accepted version of a required document (`GET /api/legal/status`'s own
 * `pending`) lands here instead of the app. `(app)/_layout.tsx`'s own `Layout` is what actually
 * REDIRECTS here (see that file's own comment on why) — this page is deliberately a plain, top-level,
 * non-`(app)` route rather than nested under `(app)/legal/accept.tsx`: it must render with no sidebar,
 * no header chrome, the same bare `PublicPageShell` frame the sign-in-less signature/portal pages use,
 * since showing the ordinary app shell around a "read this before you continue" screen would defeat
 * the point. It still requires an actual session of its own (redirects to sign-in without one) — it is
 * not a public document page, unlike `pages/legal/[slug].tsx`.
 */
export default function LegalAcceptPage() {
  const { t } = useTranslation()
  const { data: session, isPending: sessionPending } = authClient.useSession()
  const { data: status, isPending: statusPending } = useLegalStatus(!!session)
  const { data: documentsView, isPending: documentsPending } = useLegalDocuments()
  const acceptMutation = useAcceptLegal()

  if (sessionPending) return null
  if (!session) return <Navigate to="/auth/sign-in" replace />

  // Nothing pending (a direct visit, or a race with the layout's own redirect already resolving):
  // there is nothing to show here, so send the visitor on into the app rather than an empty screen.
  if (!statusPending && status && !status.requiresAcceptance) {
    return <Navigate to="/dashboard" replace />
  }

  const pendingSlugs = status?.pending ?? []
  const pendingDocs = (documentsView?.documents ?? []).filter((doc) => pendingSlugs.includes(doc.slug))
  const loading = statusPending || documentsPending

  const handleAccept = () => {
    acceptMutation.mutate(undefined, {
      onSuccess: () => {
        window.location.href = "/dashboard"
      },
    })
  }

  return (
    <PublicPageShell width="narrow" dataCy="legal-accept-page">
      <div className="space-y-6 pb-16">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            {t("legal.accept.title", "Updated legal terms")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(
              "legal.accept.description",
              "We've updated the following document(s). Please review them before continuing.",
            )}
          </p>
        </div>

        {loading && (
          <div className="space-y-3" data-cy="legal-accept-loading">
            <Skeleton className="h-5 w-1/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        )}

        {!loading &&
          pendingDocs.map((doc) => (
            <section key={doc.slug} data-cy={`legal-accept-document-${doc.slug}`}>
              <h2 className="font-heading text-lg font-semibold tracking-tight">{doc.title}</h2>
              <p className="text-xs text-muted-foreground">
                {t("legal.document.version", "Version {{version}} — effective {{date}}", {
                  version: doc.version,
                  date: doc.effectiveDate,
                })}
              </p>
              <LegalMarkdown
                content={doc.content}
                className={`max-h-64 overflow-y-auto rounded-md border p-4 ${LEGAL_CONTENT_CLASSNAME}`}
              />
            </section>
          ))}

        <Button
          className="w-full"
          onClick={handleAccept}
          loading={acceptMutation.isPending}
          disabled={loading}
          data-cy="legal-accept-btn"
        >
          {t("legal.accept.button", "I accept — continue")}
        </Button>
      </div>
    </PublicPageShell>
  )
}
