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
import { formatTotal } from "@/components/documents/document-totals"
import {
  type PublicSignatureOptionTotal,
  usePublicSignature,
  usePublicSignatureDocument,
  useRequestPublicSignatureOtp,
  useSignPublicSignature,
} from "@/hooks/queries"

type SignatureStep = "review" | "verify" | "signed"
const STEP_ORDER: SignatureStep[] = ["review", "verify", "signed"]

/** Issue #477 - the backend's own `signatures/signed-version.ts#DOCUMENT_CHANGED_CODE`, hand-mirrored
 *  here (no shared package between the two projects - the same convention `billing.settings.tsx`'s
 *  own `BILLING_EMAIL_TAKEN_CODE` already documents). Carried by the 409 the backend answers once the
 *  document changed since this link was sent, on a code request or a sign attempt; every OTHER sign
 *  refusal (wrong/expired code, locked, already signed) keeps its plain, generic message and no code. */
const DOCUMENT_CHANGED_CODE = "DOCUMENT_CHANGED_SINCE_REQUEST"

function signErrorCode(error: unknown): string | undefined {
  if (!(error instanceof ApiError)) return undefined
  return (error.body as { code?: string } | undefined)?.code
}

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
 * Issue #373 ("quotes with options") - the required radio choice between a quote's own 2+ options,
 * each with its OWN total (never a global one, see the backend's own `PublicSignatureView.options`
 * header). Rendered nothing at all for `options === null` (fewer than two, or a document type other
 * than "quote") - the ordinary single-total review this page always showed, byte-for-byte.
 *
 * Issue #512 (review follow-up) - this now lives inside the signing card's own sticky action bar, so
 * its own height directly bounds how much of a phone viewport that bar takes. Every row is forced to
 * ONE line (`min-w-0 flex-1 truncate` on the name, `shrink-0` on the price and the radio itself) -
 * at 375px wide, a two-line row (name wrapping under a long option name, or under the price) was what
 * pushed the bar's height past the readable-preview budget in the first review round. The label line
 * above the list also states which option is CURRENTLY chosen once one is, rather than only showing it
 * through the checked radio's own border/background colour - the review's own "say what you chose".
 */
function SignatureOptionChooser({
  options,
  value,
  onChange,
}: {
  options: PublicSignatureOptionTotal[]
  value: string | undefined
  onChange: (value: string) => void
}) {
  const { t } = useTranslation()
  const chosen = options.find((option) => option.name === value)
  return (
    <div className="space-y-1.5 rounded-lg border p-2" data-cy="signature-option-chooser">
      <p className="text-sm font-medium" data-cy="signature-option-chooser-label">
        {chosen
          ? t("documents.publicSignature.chosenOptionLabel", {
              name: chosen.name,
              amount: formatTotal(chosen.grossMinor, chosen.currency || ""),
            })
          : t("documents.publicSignature.chooseOptionLabel")}
      </p>
      <div className="space-y-1">
        {options.map((option) => (
          <label
            key={option.name}
            className="flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5"
            data-cy="signature-option-item"
          >
            <input
              type="radio"
              name="signature-option"
              value={option.name}
              checked={value === option.name}
              onChange={() => onChange(option.name)}
              className="shrink-0"
              data-cy="signature-option-radio"
            />
            <span className="min-w-0 flex-1 truncate">{option.name}</span>
            <span className="amount shrink-0 font-medium" data-cy="signature-option-total">
              {formatTotal(option.grossMinor, option.currency || "")}
            </span>
          </label>
        ))}
      </div>
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

  const { data: view, isLoading, error, refetch: refetchView } = usePublicSignature(token)
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
  // Issue #373 ("quotes with options") - required once `view.options` carries 2+ entries, ignored
  // (stays undefined, never sent) otherwise - see `SignatureOptionChooser`'s own header.
  const [chosenOption, setChosenOption] = useState<string | undefined>(undefined)
  const needsOptionChoice = (view?.options?.length ?? 0) >= 2

  // Fetched as soon as the request resolves, not gated on the Review step still being the current
  // one, so the delivered PDF this link is bound to (`SignaturesService.getPublicDocument`'s own
  // header, issue #477) is already in flight by the time a visitor finishes reading the header above
  // it. Never fetched for a link whose document changed: that page shows no document at all.
  const documentQuery = usePublicSignatureDocument(token, !!view && !view.changed)
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
        // Issue #477 - the document changed since this link was sent: refetch the view, whose
        // `changed` flag swaps the whole page to the explanation below.
        if (signErrorCode(err) === DOCUMENT_CHANGED_CODE) {
          void refetchView()
          return
        }
        setOtpMessage(err instanceof ApiError ? err.message : t("documents.publicSignature.genericError"))
      },
    })
  }

  const handleSign = () => {
    setSignError(null)
    sign.mutate(
      { code, ...(chosenOption ? { option: chosenOption } : {}) },
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

          // Issue #477 - the document changed while this visitor held a code: not a wrong code (the
          // backend checks the version before the code and burns no attempt), and nothing this visitor
          // can fix by choosing again. Refetch the view; its `changed` flag swaps the whole page to the
          // explanation below. This replaces #475's "choose again from the current options" retry,
          // which asked the client to sign options their PDF did not show.
          if (signErrorCode(err) === DOCUMENT_CHANGED_CODE) {
            void refetchView()
            return
          }

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

  if (view.changed) {
    return (
      <PublicPageShell width="default">
        <div className="flex min-h-[50vh] items-center justify-center p-6">
          <div
            className="w-full max-w-md space-y-2 rounded-xl border bg-card p-6 text-center"
            data-cy="signature-document-changed-card"
          >
            <p className="flex items-center justify-center gap-2 font-semibold">
              <FileWarning className="h-5 w-5 text-warning-foreground" />
              {t("documents.publicSignature.changedTitle")}
            </p>
            <p className="text-sm text-muted-foreground text-pretty">
              {view.displayNumber
                ? t("documents.publicSignature.changedDescriptionWithNumber", { number: view.displayNumber })
                : t("documents.publicSignature.changedDescription")}
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
            <>
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
              </div>

              {/* Issue #512 - the next required step (the option choice, then this button) sitting
                  below a 70vh document preview left both off screen at 1280x720/1366x768/1440x900 and
                  on a phone viewport, with nothing on screen saying there was anything to do below the
                  document. `position: sticky` on the LAST element of the card, rather than a shorter
                  preview or a two-column layout: it keeps the document at its full, already-readable
                  height (#477 binds the signature to what the client actually read, so shrinking the
                  preview to force a fit was the one option this issue's own text ruled out), pins to
                  the viewport's own bottom edge the moment this block would otherwise render below the
                  fold, and needs no per-viewport tuning to reach three different laptop heights plus a
                  phone - one CSS position covers all of them. Same idiom `document-detail.tsx`'s own
                  `document-unsaved-bar` already uses for an identical "keep the next action reachable
                  regardless of how tall the content above it is" bar, bled edge-to-edge with the SAME
                  `-mx-6 -mb-6` trick against this card's own `p-6`.
                  A side effect that resolves issue #509's own flakiness at the root: the option
                  chooser's screen position no longer depends on the PDF preview's own transient height
                  (the `<object>` embed briefly renders at 0px before the plugin lays out the real page,
                  see `cypress/support/commands.ts`'s former `revealSignatureOptionChooser` for the
                  measurements) - it is pinned to the viewport regardless, so nothing needs to wait for
                  the preview to settle before it can be scrolled to or asserted visible.
                  Issue #512 (review follow-up) - `bg-card`, not a translucent `bg-background/95` with
                  a blur: the bar sits directly over the PDF preview once its own natural position would
                  overlap it (unavoidable once the bar is pinned and the preview above it is tall - see
                  the compact `SignatureOptionChooser` above for the other half of the fix, shrinking
                  how much of the preview that overlap actually covers), and a translucent bar over a
                  document full of small print read as the preview's own text bleeding through the
                  chooser. `bg-card` is the SAME opaque token the card itself already uses (`bg-card` on
                  `signature-card` below), so the bar reads as the card's own bottom edge rather than a
                  floating pane, in both themes - `--card` carries no alpha channel in either
                  `:root` or `.dark` (`index.css`). The `border-t` plus this shadow are what mark it as
                  a distinct layer instead of just "the card got shorter". */}
              <div
                className="sticky bottom-0 z-10 -mx-6 -mb-6 space-y-2 rounded-b-xl border-t bg-card px-6 py-3 shadow-[0_-4px_12px_-6px_rgba(0,0,0,0.18)]"
                data-cy="signature-action-bar"
              >
                {needsOptionChoice && view.options && (
                  <SignatureOptionChooser
                    options={view.options}
                    value={chosenOption}
                    onChange={setChosenOption}
                  />
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
                  disabled={!hasReadDocument || (needsOptionChoice && !chosenOption)}
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
            </>
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
                disabled={code.length !== 8 || (needsOptionChoice && !chosenOption)}
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
