import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { EyeClosedIcon, EyeIcon, TicketIcon, UserX } from "lucide-react"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ServerUnavailableBanner } from "@/components/server-unavailable-banner"
import type React from "react"
import { authClient } from "@/lib/auth"
import { toast } from "sonner"
import { useBackendHealth } from "@/hooks/use-backend-health"
import { useNavigate } from "react-router"
import { useTranslation } from "react-i18next"

type SignupFormData = {
  firstname: string
  lastname: string
  email: string
  password: string
  invitationCode?: string
}

export default function SignupPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [errors, setErrors] = useState<Partial<Record<keyof SignupFormData, string[]>>>({})
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  // Whether an account can be created with NO invitation code right now. `null` means
  // "unknown" (the check hasn't resolved yet, or the backend was unreachable) — treated
  // as permissive on the client, since the actual gate is enforced server-side regardless
  // (see backend/src/lib/registration-policy.ts); this is only used to warn the visitor
  // up front instead of letting them fill the whole form before finding out.
  const [openSignupAllowed, setOpenSignupAllowed] = useState<boolean | null>(null)
  const [checkingRegistrationStatus, setCheckingRegistrationStatus] = useState(true)
  const backendHealth = useBackendHealth()
  const backendUnavailable = backendHealth === "unavailable"

  const getEnvVariable = (key: string): string | undefined => {
    return (window as any).__APP_CONFIG__?.[key] || import.meta.env[key]
  }

  const backendUrl = getEnvVariable("VITE_BACKEND_URL") || ""

  // Sign-up is open to everyone by default; an invitation code is only ever needed to
  // join an existing company, or when the operator has closed open sign-up (DISABLE_AUTH).
  // Ask the backend up front (with no code) so a closed instance can be explained before
  // the visitor fills in the whole form, instead of only after submitting.
  useEffect(() => {
    const checkRegistrationStatus = async () => {
      try {
        const response = await fetch(`${backendUrl}/api/invitations/can-register`)
        if (!response.ok) {
          // Backend reachable but erroring (e.g. DB down -> 500). Don't assume closed;
          // the server-unavailable banner handles the warning.
          throw new Error(`can-register failed with status ${response.status}`)
        }
        const data = await response.json()
        setOpenSignupAllowed(!!data.allowed)
      } catch (error) {
        console.error("Error checking registration status:", error)
        setOpenSignupAllowed(null)
      } finally {
        setCheckingRegistrationStatus(false)
      }
    }

    checkRegistrationStatus()
  }, [backendUrl])

  const validateInvitationCode = async (code: string, email: string): Promise<boolean> => {
    try {
      const response = await fetch(`${backendUrl}/api/invitations/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, email }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.message || t("auth.signup.errors.invalidInvitationCode"))
      }

      return true
    } catch (error) {
      if (error instanceof Error) {
        toast.error(error.message)
      }
      return false
    }
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setErrors({})

    const formData = new FormData(event.currentTarget)
    const data: SignupFormData = {
      firstname: formData.get("firstname") as string,
      lastname: formData.get("lastname") as string,
      email: formData.get("email") as string,
      password: formData.get("password") as string,
      invitationCode: (formData.get("invitationCode") as string)?.trim(),
    }

    if (data.invitationCode) {
      // A code was typed in: it must check out on its own, regardless of whether open
      // sign-up is currently allowed — a code is its own authorization to join a company.
      setLoading(true)
      const isValid = await validateInvitationCode(data.invitationCode, data.email)
      if (!isValid) {
        setLoading(false)
        return
      }
    } else if (openSignupAllowed === false) {
      // No code, and we already know open sign-up is closed: fail fast instead of
      // round-tripping through authClient only to get the same answer back.
      setErrors({ invitationCode: [t("auth.signup.errors.invitationCodeRequired")] })
      return
    } else {
      setLoading(true)
    }

    const result = await authClient.signUp.email({
      email: data.email,
      password: data.password,
      // better-auth >=1.6 requires `name` on email sign-up; derive it from the
      // first/last name (the backend create hook recomputes the same value).
      name: `${data.firstname} ${data.lastname}`.trim(),
      // @ts-expect-error additional fields
      firstname: data.firstname,
      lastname: data.lastname,
    })

    setLoading(false)

    if (result.error) {
      toast.error(result.error.message || t("auth.signup.errors.genericError"))
    }

    if (result.data?.user.createdAt) {
      toast.success(t("auth.signup.messages.accountCreated"))
      setTimeout(() => {
        navigate("/auth/sign-in")
      }, 1000)
    }
  }

  const handleOIDCLogin = () => {
    const oidcProviderId = getEnvVariable("VITE_OIDC_PROVIDER_ID")

    authClient.signIn.oauth2({
      providerId: oidcProviderId || "oidc",
      callbackURL: "/dashboard",
    })
  }

  if (checkingRegistrationStatus) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl font-bold text-center">{t("auth.signup.title")}</CardTitle>
          <CardDescription className="text-center">{t("auth.signup.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          {backendUnavailable && <ServerUnavailableBanner />}
          {!backendUnavailable && openSignupAllowed === false && (
            <Alert className="mb-4" data-cy="auth-signup-closed-banner">
              <UserX />
              <AlertTitle>{t("auth.signup.closedBanner.title")}</AlertTitle>
              <AlertDescription>{t("auth.signup.closedBanner.description")}</AlertDescription>
            </Alert>
          )}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="firstname">{t("auth.signup.form.firstname.label")}</Label>
                <Input
                  id="firstname"
                  name="firstname"
                  placeholder={t("auth.signup.form.firstname.placeholder")}
                  disabled={loading}
                  data-cy="auth-firstname-input"
                />
                {errors.firstname && <p className="text-sm text-red-600">{errors.firstname[0]}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastname">{t("auth.signup.form.lastname.label")}</Label>
                <Input
                  id="lastname"
                  name="lastname"
                  placeholder={t("auth.signup.form.lastname.placeholder")}
                  disabled={loading}
                  data-cy="auth-lastname-input"
                />
                {errors.lastname && <p className="text-sm text-red-600">{errors.lastname[0]}</p>}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">{t("auth.signup.form.email.label")}</Label>
              <Input
                id="email"
                name="email"
                type="email"
                placeholder={t("auth.signup.form.email.placeholder")}
                disabled={loading}
                data-cy="auth-email-input"
              />
              {errors.email && <p className="text-sm text-red-600">{errors.email[0]}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{t("auth.signup.form.password.label")}</Label>

              <div className="flex items-center justify-between gap-2">
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  placeholder={t("auth.signup.form.password.placeholder")}
                  disabled={loading}
                  data-cy="auth-password-input"
                />
                <Button type="button" variant="outline" onClick={() => setShowPassword((prev) => !prev)}>
                  {showPassword ? <EyeClosedIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
                </Button>
              </div>

              {errors.password && (
                <div className="space-y-1">
                  <p className="text-sm text-red-600">{t("auth.signup.form.password.requirements")}</p>
                  <ul className="text-sm text-red-600 list-disc list-inside">
                    {errors.password.map((error, index) => (
                      <li key={index}>{error}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Always shown, always optional: a code only ever serves to join an existing
                company (see backend/src/lib/registration-policy.ts) — leaving it blank
                creates a brand-new account that lands on the company-creation onboarding. */}
            <div className="space-y-2">
              <Label htmlFor="invitationCode">{t("auth.signup.form.invitationCode.label")}</Label>
              <div className="flex items-center gap-2">
                <TicketIcon className="h-4 w-4 text-muted-foreground" />
                <Input
                  id="invitationCode"
                  name="invitationCode"
                  placeholder={t("auth.signup.form.invitationCode.placeholder")}
                  disabled={loading}
                  className="font-mono uppercase"
                  data-cy="auth-invitation-code-input"
                />
              </div>
              <p className="text-xs text-muted-foreground">{t("auth.signup.form.invitationCode.hint")}</p>
              {errors.invitationCode && <p className="text-sm text-red-600">{errors.invitationCode[0]}</p>}
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={loading || backendUnavailable}
              data-cy="auth-submit-btn"
            >
              {loading ? t("auth.signup.form.creatingAccount") : t("auth.signup.form.createButton")}
            </Button>
          </form>
          <section className="flex flex-col mt-4 gap-1">
            <div className="text-center text-sm">
              {t("auth.signup.hasAccount")}{" "}
              <a
                href="/auth/sign-in"
                className="underline hover:text-primary cursor-pointer"
                data-cy="auth-signin-link"
              >
                {t("auth.signup.signInLink")}
              </a>
            </div>
            {getEnvVariable("VITE_OIDC_PROVIDER_ID") && (
              <div className="text-center text-sm">
                {t("auth.login.oidc")}{" "}
                <Button variant="link" onClick={handleOIDCLogin} className="underline hover:text-primary p-0">
                  {t("auth.login.oidcLink")}
                </Button>
              </div>
            )}
          </section>
        </CardContent>
      </Card>
    </div>
  )
}
