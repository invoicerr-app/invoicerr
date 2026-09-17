import { CheckCircle2, Download, FileWarning } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useParams } from "react-router"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { ConfirmationDialog } from "@/components/confirmation-dialog"
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp"
import { Label } from "@/components/ui/label"
import { PublicPageShell } from "@/components/public-page-shell"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { ApiError } from "@/hooks/use-api-query"
import {
  usePublicSignature,
  usePublicSignatureDocument,
  useRequestPublicSignatureOtp,
  useSignPublicSignature,
} from "@/hooks/queries"

type SignatureStep = "review" | "verify" | "signed"
const STEP_ORDER: SignatureStep[] = ["review", "verify", "signed"]

/** The same "fait / en cours / à venir" dot-and-line stepper the company-onboarding wizard uses
 *  (`components/onboarding.tsx`) — three fixed steps here (no branching, unlike onboarding), so no
 *  step count/labels are computed, only which of the three is current. */
function SignatureStepper({ current }: { current: SignatureStep }) {
  const { t } = useTranslation()
  const labels: Record<SignatureStep, string> = {
    review: t("documents.publicSignature.steps.review"),
    verify: t("documents.publicSignature.steps.verify"),
    signed: t("documents.publicSignature.steps.signed"),
  }
  const currentIndex = STEP_ORDER.indexOf(current)

  return (
    <div className="flex items-center justify-center gap-1.5" data-cy="signature-stepper">
      {STEP_ORDER.map((step, index) => {
        const isDone = index < currentIndex
        const isActive = step === current
        return (
          <div key={step} className="flex items-center gap-1.5">
            <span
              className={cn(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium",
                isDone
                  ? "border-primary bg-primary text-primary-foreground"
                  : isActive
                    ? "border-primary text-primary"
                    : "border-muted-foreground/30 text-muted-foreground",
              )}
            >
              {isDone ? <CheckCircle2 className="h-3.5 w-3.5" /> : index + 1}
            </span>
            <span
              className={cn("text-xs", isActive ? "font-medium text-foreground" : "text-muted-foreground")}
            >
              {labels[step]}
            </span>
            {index < STEP_ORDER.length - 1 && <div className="mx-0.5 h-px w-4 bg-border" />}
          </div>
        )
      })}
    </div>
  )
}

/**
 * The Review step's own document panel — an object URL over the blob `usePublicSignatureDocument`
 * fetches, never a raw `blob:` reference handed straight to `<object>` from the query result: the URL
 * must be revoked (`DocumentPreview`'s caller does that) once nothing references it any more, or the
 * bytes leak for the life of the tab. `<object>` (not a bare `<iframe>`) because it has an actual
 * FALLBACK mechanism — its children render only when the browser genuinely cannot embed the PDF — and
 * the small "open in a new tab" line below the frame is a SECOND, always-visible fallback for the
 * subtler case this app cannot detect on its own: the embed "succeeds" but renders too small or
 * non-interactive to actually read (some mobile webviews).
 */
function DocumentPreview({
  isLoading,
  isError,
  error,
  documentUrl,
}: {
  isLoading: boolean
  isError: boolean
  error: unknown
  documentUrl: string | null
}) {
  const { t } = useTranslation()

  if (isLoading || (!documentUrl && !isError)) {
    return (
      <Skeleton className="h-[50vh] w-full rounded-lg sm:h-[70vh]" data-cy="signature-document-loading" />
    )
  }

  if (isError || !documentUrl) {
    return (
      <div
        className="flex h-[50vh] w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-center sm:h-[70vh]"
        data-cy="signature-document-error"
      >
        <FileWarning className="h-6 w-6 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          {error instanceof ApiError ? error.message : t("documents.publicSignature.documentLoadError")}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <object
        data={documentUrl}
        type="application/pdf"
        className="h-[50vh] w-full rounded-lg border sm:h-[70vh]"
        aria-label={t("documents.publicSignature.documentPreviewLabel")}
        data-cy="signature-document-preview"
      >
        {/* Rendered only when the browser cannot embed a PDF at all — see this component's own header. */}
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-6 text-center">
          <p className="text-sm text-muted-foreground">{t("documents.publicSignature.previewUnavailable")}</p>
          <Button asChild variant="outline" size="sm" dataCy="signature-open-pdf-fallback-button">
            <a href={documentUrl} target="_blank" rel="noreferrer">
              {t("documents.publicSignature.openPdfButton")}
            </a>
          </Button>
        </div>
      </object>
      <p className="text-center text-xs text-muted-foreground">
        {t("documents.publicSignature.previewTroubleHint")}{" "}
        <a
          href={documentUrl}
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-4 hover:text-foreground"
          data-cy="signature-open-pdf-link"
        >
          {t("documents.publicSignature.openPdfButton")}
        </a>
      </p>
    </div>
  )
}

/**
 * The public `/signature/:token` page: an anonymous client opens the
 * emailed link, reviews the document, asks for a verification code, and submits it. No
 * `@ActiveCompany()`, no session, no sidebar (this route is one of `(app)/_layout.tsx`'s own
 * `ALLOWED_PATHS`, rendered through `UnauthenticatedLayout` for a visitor with no session — see that
 * file's own header). Shares `PublicPageShell` with the client portal (`pages/portal/index.tsx`) — the
 * ONE frame every public, no-session page in this app renders through — rather than any authenticated
 * document screen: this page has nothing in common with the document list/form beyond both ultimately
 * talking to the same backend. `width="default"` (not `narrow`): once the Review step embeds a
 * full-width PDF, the ~28rem `narrow` column made the preview cramped — the same reasoning
 * `pages/legal/accept.tsx` already documents for its own switch away from `narrow`.
 *
 * Every backend refusal (unknown token, locked, already signed, wrong/expired code) surfaces as a
 * plain `ApiError` with an already human-readable message — see the backend's own
 * `SignaturesService` header for why every one of those reads the SAME generic sentence: this page
 * never tries to guess a friendlier, more specific message than the one the backend deliberately
 * chose not to give it.
 */
export default function PublicSignaturePage() {
  const { t } = useTranslation()
  const { token = "" } = useParams()

  const { data: view, isLoading, error } = usePublicSignature(token)
  const requestOtp = useRequestPublicSignatureOtp(token)
  const sign = useSignPublicSignature(token)

  const [otpRequested, setOtpRequested] = useState(false)
  const [code, setCode] = useState("")
  const [signedAt, setSignedAt] = useState<string | null>(null)
  const [signError, setSignError] = useState<string | null>(null)
  const [otpMessage, setOtpMessage] = useState<string | null>(null)
  const [hasReadDocument, setHasReadDocument] = useState(false)
  // The code alone unlocks "Sign" (below) but never submits it — issue #198 asked for an explicit
  // confirmation before a signature is sealed, and sealing is exactly the one step in this whole flow
  // that cannot be walked back (no "unsign"). This state gates that second, deliberate step.
  const [confirmSignOpen, setConfirmSignOpen] = useState(false)

  // Fetched as soon as the request resolves — not gated on the Review step still being the current
  // one — so the SAME "render once, freeze, serve forever" artifact the backend promises
  // (`SignaturesService.getPublicDocument`'s own header) is already in flight by the time a visitor
  // finishes reading the header above it.
  const documentQuery = usePublicSignatureDocument(token, !!view)
  const [documentUrl, setDocumentUrl] = useState<string | null>(null)

  // Object URLs are a browser-memory resource, not the query cache's own concern — created once per
  // fetched `Blob` and explicitly revoked, whether by a fresh blob replacing it or by this page
  // unmounting, or the bytes leak for the tab's whole remaining lifetime.
  useEffect(() => {
    if (!documentQuery.data) return
    const url = URL.createObjectURL(documentQuery.data)
    setDocumentUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [documentQuery.data])

  const handleRequestOtp = () => {
    setOtpMessage(null)
    requestOtp.mutate(undefined, {
      onSuccess: () => {
        setOtpRequested(true)
        setOtpMessage(t("documents.publicSignature.codeSent"))
      },
      onError: (err) => {
        setOtpMessage(err instanceof ApiError ? err.message : t("documents.publicSignature.genericError"))
      },
    })
  }

  const handleSign = () => {
    setSignError(null)
    sign.mutate(
      { code },
      {
        // No `setConfirmSignOpen(false)` here: a success swaps the whole page to the "signed" branch
        // below (`signedAt` becomes truthy), which unmounts this dialog along with everything else in
        // this branch — an extra close call would just be a no-op racing that unmount.
        onSuccess: (result) => setSignedAt(result.signedAt),
        onError: (err) => {
          // Closed back to the Verify step on failure so the existing `signError` line there is what
          // the visitor actually sees — leaving the confirmation open would bury a "wrong code" refusal
          // behind a dialog that has nothing to say about it.
          setConfirmSignOpen(false)
          setSignError(err instanceof ApiError ? err.message : t("documents.publicSignature.genericError"))
        },
      },
    )
  }

  if (isLoading) {
    return (
      <PublicPageShell width="default">
        <div className="flex min-h-[50vh] items-center justify-center p-6">
          <div className="w-full max-w-sm space-y-4 rounded-xl border bg-card p-6">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        </div>
      </PublicPageShell>
    )
  }

  if (error || !view) {
    return (
      <PublicPageShell width="default">
        <div className="flex min-h-[50vh] items-center justify-center p-6">
          <div
            className="w-full max-w-sm space-y-2 rounded-xl border bg-card p-6 text-center"
            data-cy="signature-unavailable-card"
          >
            <p className="flex items-center justify-center gap-2 font-semibold text-destructive">
              <FileWarning className="h-5 w-5" />
              {t("documents.publicSignature.unavailableTitle")}
            </p>
            <p className="text-sm text-muted-foreground">
              {error instanceof ApiError
                ? error.message
                : t("documents.publicSignature.unavailableDescription")}
            </p>
          </div>
        </div>
      </PublicPageShell>
    )
  }

  if (signedAt) {
    return (
      <PublicPageShell width="default">
        <div className="flex min-h-[50vh] items-center justify-center p-6">
          <div
            className="w-full max-w-sm space-y-3 rounded-xl border bg-card p-6 text-center"
            data-cy="signature-success-card"
          >
            <SignatureStepper current="signed" />
            <p className="flex items-center justify-center gap-2 font-semibold text-success-foreground">
              <CheckCircle2 className="h-5 w-5" />
              {t("documents.publicSignature.successTitle")}
            </p>
            <p className="text-sm text-muted-foreground">
              {t("documents.publicSignature.successDescription")}
            </p>
            <p className="text-xs text-muted-foreground" data-cy="signature-signed-at">
              {t("documents.publicSignature.signedAtLabel", {
                date: new Date(signedAt).toLocaleString(),
              })}
            </p>
          </div>
        </div>
      </PublicPageShell>
    )
  }

  const downloadFilename = `${view.typeId}${view.displayNumber ? `-${view.displayNumber}` : ""}.pdf`

  return (
    <PublicPageShell width="default">
      <div className="flex justify-center p-6">
        <div className="w-full max-w-2xl space-y-5 rounded-xl border bg-card p-6" data-cy="signature-card">
          <SignatureStepper current={otpRequested ? "verify" : "review"} />

          <div className="space-y-1 text-center">
            <h1 className="font-heading text-lg font-semibold tracking-tight">
              {t("documents.publicSignature.title")}
            </h1>
            <p className="text-sm text-muted-foreground text-pretty">
              {view.displayNumber
                ? t("documents.publicSignature.descriptionWithNumber", { number: view.displayNumber })
                : t("documents.publicSignature.description")}
            </p>
          </div>

          {!otpRequested && (
            <div className="space-y-4">
              <DocumentPreview
                isLoading={documentQuery.isLoading}
                isError={documentQuery.isError}
                error={documentQuery.error}
                documentUrl={documentUrl}
              />

              {documentUrl && (
                <div className="flex justify-center">
                  <Button asChild variant="outline" size="sm" dataCy="signature-download-button">
                    <a href={documentUrl} download={downloadFilename}>
                      <Download className="h-4 w-4" />
                      {t("documents.publicSignature.downloadButton")}
                    </a>
                  </Button>
                </div>
              )}

              <div className="mx-auto flex max-w-sm items-start gap-2 text-left">
                <Checkbox
                  id="signature-confirm-read"
                  checked={hasReadDocument}
                  onCheckedChange={(checked) => setHasReadDocument(checked === true)}
                  disabled={!documentUrl}
                  className="mt-0.5"
                  data-cy="signature-confirm-read-checkbox"
                />
                <Label
                  htmlFor="signature-confirm-read"
                  className="text-sm font-normal leading-snug text-muted-foreground"
                >
                  {t("documents.publicSignature.confirmReadLabel")}
                </Label>
              </div>

              <Button
                type="button"
                className="mx-auto block w-full max-w-sm"
                disabled={!hasReadDocument}
                loading={requestOtp.isPending}
                onClick={handleRequestOtp}
                dataCy="signature-request-otp-button"
              >
                {t("documents.publicSignature.requestCodeButton")}
              </Button>

              {otpMessage && (
                <p className="text-center text-sm text-muted-foreground" data-cy="signature-otp-message">
                  {otpMessage}
                </p>
              )}
            </div>
          )}

          {otpRequested && (
            <div className="mx-auto w-full max-w-sm space-y-4">
              <div className="flex justify-center">
                <InputOTP maxLength={8} value={code} onChange={(value) => setCode(value.replace(/\D/g, ""))}>
                  <InputOTPGroup data-cy="signature-otp-input">
                    {Array.from({ length: 8 }).map((_, index) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: a fixed-length, never-reordered slot list.
                      <InputOTPSlot key={index} index={index} />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
              </div>

              {signError && (
                <p className="text-center text-sm text-destructive" data-cy="signature-sign-error">
                  {signError}
                </p>
              )}

              {/* Opens the confirmation below rather than signing directly — the code alone only
                  proves the visitor received the email, not that they meant to press this exact
                  button. `sign.mutate` itself only ever fires from the dialog's own confirm button. */}
              <Button
                type="button"
                className="w-full"
                disabled={code.length !== 8}
                onClick={() => setConfirmSignOpen(true)}
                dataCy="signature-sign-button"
              >
                {t("documents.publicSignature.signButton")}
              </Button>

              <Button
                type="button"
                variant="link"
                className="w-full"
                loading={requestOtp.isPending}
                onClick={handleRequestOtp}
                dataCy="signature-resend-otp-button"
              >
                {t("documents.publicSignature.resendCodeButton")}
              </Button>

              {otpMessage && (
                <p className="text-center text-sm text-muted-foreground" data-cy="signature-otp-message">
                  {otpMessage}
                </p>
              )}

              <ConfirmationDialog
                open={confirmSignOpen}
                onOpenChange={setConfirmSignOpen}
                title={t("documents.publicSignature.confirmSign.title")}
                description={
                  view.displayNumber
                    ? t("documents.publicSignature.confirmSign.descriptionWithNumber", {
                        number: view.displayNumber,
                      })
                    : t("documents.publicSignature.confirmSign.description")
                }
                confirmLabel={t("documents.publicSignature.confirmSign.confirm")}
                cancelLabel={t("documents.publicSignature.confirmSign.back")}
                onConfirm={handleSign}
                loading={sign.isPending}
                dataCy="signature-confirm-dialog"
              />
            </div>
          )}
        </div>
      </div>
    </PublicPageShell>
  )
}
