import { useState } from "react"
import { useParams } from "react-router"
import { useTranslation } from "react-i18next"
import { CheckCircle2, FileWarning } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError } from "@/hooks/use-api-query"
import { usePublicSignature, useRequestPublicSignatureOtp, useSignPublicSignature } from "@/hooks/queries"

/**
 * The public `/signature/:token` page: an anonymous client opens the
 * emailed link, asks for a verification code, and submits it. No `@ActiveCompany()`, no session, no
 * sidebar (this route is one of `(app)/_layout.tsx`'s own `ALLOWED_PATHS`, rendered through
 * `UnauthenticatedLayout` for a visitor with no session — see that file's own header). Mirrors
 * `auth/sign-in.tsx`'s own "centered card" shape rather than any authenticated document screen: this
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
  const [signed, setSigned] = useState(false)
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
        onSuccess: () => setSigned(true),
        onError: (err) => {
          setSignError(err instanceof ApiError ? err.message : t("documents.publicSignature.genericError"))
        },
      },
    )
  }

  if (isLoading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <Card className="w-full max-w-sm md:max-w-md">
          <CardHeader>
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-4 w-full" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-9 w-full" />
          </CardContent>
        </Card>
      </div>
    )
  }

  if (error || !view) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <Card className="w-full max-w-sm md:max-w-md" data-cy="signature-unavailable-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <FileWarning className="h-5 w-5" />
              {t("documents.publicSignature.unavailableTitle")}
            </CardTitle>
            <CardDescription>
              {error instanceof ApiError
                ? error.message
                : t("documents.publicSignature.unavailableDescription")}
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  if (signed) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <Card className="w-full max-w-sm md:max-w-md" data-cy="signature-success-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-green-600">
              <CheckCircle2 className="h-5 w-5" />
              {t("documents.publicSignature.successTitle")}
            </CardTitle>
            <CardDescription>{t("documents.publicSignature.successDescription")}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <Card className="w-full max-w-sm md:max-w-md" data-cy="signature-card">
        <CardHeader>
          <CardTitle>{t("documents.publicSignature.title")}</CardTitle>
          <CardDescription>
            {view.displayNumber
              ? t("documents.publicSignature.descriptionWithNumber", { number: view.displayNumber })
              : t("documents.publicSignature.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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
        </CardContent>
      </Card>
    </div>
  )
}
