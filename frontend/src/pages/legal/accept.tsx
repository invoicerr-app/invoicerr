import { useTranslation } from "react-i18next"
import { Navigate } from "react-router"
import { toast } from "sonner"

import { PublicPageShell } from "@/components/public-page-shell"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ApiError } from "@/hooks/use-api-query"
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
      // Without this, a failed `POST /legal/accept` (an expired session, a transient 500) left the
      // spinner just stop, with no other sign anything happened: this screen blocks the entire app shell
      // ((app)/_layout.tsx's own redirect here), so a silent failure trapped the visitor on it with
      // no way forward except signing out by hand. `acceptMutation.isPending` going back to `false`
      // already re-enables the button (`Button`'s own `disabled={disabled || loading}`) — this only
      // adds the part that was missing: telling the user it failed, and why, so retrying isn't a
      // guess.
      onError: (error) => {
        toast.error(error instanceof ApiError ? error.message : t("legal.accept.error"))
      },
    })
  }

  // `defaultValue` only matters once `pendingDocs` is non-empty; Radix keeps whatever value was
  // current if that document later drops out of the list (e.g. the mutation resolves mid-render),
  // which is harmless here since a successful accept navigates away immediately.
  const firstPendingSlug = pendingDocs[0]?.slug

  return (
    // `default` (not `narrow`, which `[slug].tsx` and the signature page use for a single centred
    // card): this screen can show several full documents at once, and `narrow`'s ~28rem column made
    // it read as a mobile view even at desktop widths — a lone card floating in a sea of empty page.
    // The document body itself still caps its own measure below, so the wider column only gives the
    // header/tabs/button room to breathe, not longer text lines.
    <PublicPageShell width="default" dataCy="legal-accept-page">
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
          <div className="max-w-2xl space-y-3" data-cy="legal-accept-loading">
            <Skeleton className="h-5 w-1/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        )}

        {/* One document renders on its own, no tab strip — the strip only earns its place (and its
            up-front "which one am I reading" decision) once there is more than one to choose from. */}
        {!loading && pendingDocs.length > 0 && (
          <Tabs defaultValue={firstPendingSlug}>
            {pendingDocs.length > 1 && (
              <TabsList
                aria-label={t("legal.accept.documentsTabsLabel", "Documents to review")}
                data-cy="legal-accept-tabs"
              >
                {pendingDocs.map((doc) => (
                  <TabsTrigger key={doc.slug} value={doc.slug} data-cy={`legal-accept-tab-${doc.slug}`}>
                    {doc.title}
                  </TabsTrigger>
                ))}
              </TabsList>
            )}
            {pendingDocs.map((doc) => (
              <TabsContent key={doc.slug} value={doc.slug} data-cy={`legal-accept-document-${doc.slug}`}>
                {/* `max-w-2xl` caps the reading measure at a comfortable ~75 characters per line even
                    though the page column above is wider — a long-form legal text stretched across
                    the full column would be harder to read, not easier. */}
                <div className="max-w-2xl">
                  {pendingDocs.length === 1 && (
                    <h2 className="font-heading text-lg font-semibold tracking-tight">{doc.title}</h2>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {t("legal.document.version", "Version {{version}} — effective {{date}}", {
                      version: doc.version,
                      date: doc.effectiveDate,
                    })}
                  </p>
                  <LegalMarkdown content={doc.content} className={`mt-4 ${LEGAL_CONTENT_CLASSNAME}`} />
                </div>
              </TabsContent>
            ))}
          </Tabs>
        )}

        <Button
          className="w-full max-w-2xl"
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
