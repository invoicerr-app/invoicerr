import { CheckCircle2, FileWarning } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useParams } from "react-router"

import { Button } from "@/components/ui/button"
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp"
import { PublicPageShell } from "@/components/public-page-shell"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { ApiError } from "@/hooks/use-api-query"
import { usePublicSignature, useRequestPublicSignatureOtp, useSignPublicSignature } from "@/hooks/queries"

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
 * The public `/signature/:token` page: an anonymous client opens the
 * emailed link, asks for a verification code, and submits it. No `@ActiveCompany()`, no session, no
 * sidebar (this route is one of `(app)/_layout.tsx`'s own `ALLOWED_PATHS`, rendered through
 * `UnauthenticatedLayout` for a visitor with no session — see that file's own header). Shares
 * `PublicPageShell` with the client portal (`pages/portal/index.tsx`) — the ONE frame every public,
 * no-session page in this app renders through — rather than any authenticated document screen: this
 * page has nothing in common with the document list/form beyond both ultimately talking to the same
 * backend.
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
        onSuccess: (result) => setSignedAt(result.signedAt),
        onError: (err) => {
          setSignError(err instanceof ApiError ? err.message : t("documents.publicSignature.genericError"))
        },
      },
    )
  }

  if (isLoading) {
    return (
      <PublicPageShell width="narrow">
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
      <PublicPageShell width="narrow">
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
      <PublicPageShell width="narrow">
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

  return (
    <PublicPageShell width="narrow">
      <div className="flex min-h-[50vh] items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-5 rounded-xl border bg-card p-6" data-cy="signature-card">
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

          <div className="space-y-4">
            {!otpRequested && (
              <Button
                type="button"
                className="w-full"
                loading={requestOtp.isPending}
                onClick={handleRequestOtp}
                dataCy="signature-request-otp-button"
              >
                {t("documents.publicSignature.requestCodeButton")}
              </Button>
            )}

            {otpRequested && (
              <>
                <div className="flex justify-center">
                  <InputOTP
                    maxLength={8}
                    value={code}
                    onChange={(value) => setCode(value.replace(/\D/g, ""))}
                  >
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

                <Button
                  type="button"
                  className="w-full"
                  disabled={code.length !== 8}
                  loading={sign.isPending}
                  onClick={handleSign}
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
              </>
            )}

            {otpMessage && (
              <p className="text-center text-sm text-muted-foreground" data-cy="signature-otp-message">
                {otpMessage}
              </p>
            )}
          </div>
        </div>
      </div>
    </PublicPageShell>
  )
}
