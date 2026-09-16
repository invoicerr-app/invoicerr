import { TicketIcon, UserX } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router"
import { toast } from "sonner"

import { AuthLink, AuthShell } from "@/pages/auth/_components/auth-shell"
import { PasswordInput } from "@/pages/auth/_components/password-input"
import { PasswordStrength } from "@/pages/auth/_components/password-strength"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ServerUnavailableBanner } from "@/components/server-unavailable-banner"
import type React from "react"
import { authClient } from "@/lib/auth"
import { envOidcProviderId, getEnvVariable, isOidcOnly } from "@/lib/runtime-config"
import { useBackendHealth } from "@/hooks/use-backend-health"

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
  const [password, setPassword] = useState("")
  // Whether an account can be created with NO invitation code right now. `null` means
  // "unknown" (the check hasn't resolved yet, or the backend was unreachable) — treated
  // as permissive on the client, since the actual gate is enforced server-side regardless
  // (see backend/src/lib/registration-policy.ts); this is only used to warn the visitor
  // up front instead of letting them fill the whole form before finding out.
  const [openSignupAllowed, setOpenSignupAllowed] = useState<boolean | null>(null)
  const [checkingRegistrationStatus, setCheckingRegistrationStatus] = useState(true)
  const backendHealth = useBackendHealth()
  const backendUnavailable = backendHealth === "unavailable"

  const backendUrl = getEnvVariable("VITE_BACKEND_URL") || ""
  const oidcOnly = isOidcOnly()
  const envProviderId = envOidcProviderId()

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
    // Same core social sign-in as the login page — see src/pages/auth/sign-in.tsx. The id comes from
    // `envOidcProviderId()`, which is published only when the backend actually registered a provider.
    if (!envProviderId) return
    authClient.signIn.social({ provider: envProviderId, callbackURL: "/dashboard" })
  }

  // On a single-sign-on-only instance there is nothing to sign up FOR: an account can only come into
  // existence through an identity provider, and the backend refuses email sign-up outright. Say so
  // instead of rendering a form that cannot succeed.
  if (oidcOnly) {
    return (
      <AuthShell
        title={t("auth.signup.oidcOnly.title", "Single sign-on only")}
        description={t(
          "auth.signup.oidcOnly.description",
          "This instance does not use passwords. Sign in with your organisation's identity provider.",
        )}
        footer={
          <AuthLink href="/auth/sign-in" dataCy="auth-signin-link">
            {t("auth.signup.oidcOnly.backToSignIn", "Back to sign in")}
          </AuthLink>
        }
        dataCy="auth-card"
      >
        {envProviderId && (
          <Button className="w-full" onClick={handleOIDCLogin} data-cy="auth-oidc-btn">
            {t("auth.login.oidcLink")}
          </Button>
        )}
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title={t("auth.signup.title")}
      description={t("auth.signup.description")}
      footer={
        <>
          <span className="text-muted-foreground">
            {t("auth.signup.hasAccount")}{" "}
            <AuthLink href="/auth/sign-in" dataCy="auth-signin-link">
              {t("auth.signup.signInLink")}
            </AuthLink>
          </span>
          {envProviderId && (
            <span className="text-muted-foreground">
              {t("auth.login.oidc")}{" "}
              <Button variant="link" onClick={handleOIDCLogin} className="h-auto p-0">
                {t("auth.login.oidcLink")}
              </Button>
            </span>
          )}
        </>
      }
      dataCy="auth-card"
    >
      {backendUnavailable && <ServerUnavailableBanner />}
      {!checkingRegistrationStatus && !backendUnavailable && openSignupAllowed === false && (
        <Alert data-cy="auth-signup-closed-banner">
          <UserX />
          <AlertTitle>{t("auth.signup.closedBanner.title")}</AlertTitle>
          <AlertDescription>{t("auth.signup.closedBanner.description")}</AlertDescription>
        </Alert>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="firstname">{t("auth.signup.form.firstname.label")}</Label>
            <Input
              id="firstname"
              name="firstname"
              placeholder={t("auth.signup.form.firstname.placeholder")}
              disabled={loading}
              data-cy="auth-firstname-input"
            />
            {errors.firstname && <p className="text-sm text-destructive">{errors.firstname[0]}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lastname">{t("auth.signup.form.lastname.label")}</Label>
            <Input
              id="lastname"
              name="lastname"
              placeholder={t("auth.signup.form.lastname.placeholder")}
              disabled={loading}
              data-cy="auth-lastname-input"
            />
            {errors.lastname && <p className="text-sm text-destructive">{errors.lastname[0]}</p>}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">{t("auth.signup.form.email.label")}</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder={t("auth.signup.form.email.placeholder")}
            disabled={loading}
            data-cy="auth-email-input"
          />
          {errors.email && <p className="text-sm text-destructive">{errors.email[0]}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">{t("auth.signup.form.password.label")}</Label>
          <PasswordInput
            id="password"
            name="password"
            autoComplete="new-password"
            placeholder={t("auth.signup.form.password.placeholder")}
            disabled={loading}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            data-cy="auth-password-input"
          />
          <PasswordStrength value={password} />
          {errors.password && (
            <div className="space-y-1">
              <p className="text-sm text-destructive">{t("auth.signup.form.password.requirements")}</p>
              <ul className="list-inside list-disc text-sm text-destructive">
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
        <div className="space-y-1.5">
          <Label htmlFor="invitationCode">{t("auth.signup.form.invitationCode.label")}</Label>
          <div className="relative">
            <TicketIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="invitationCode"
              name="invitationCode"
              placeholder={t("auth.signup.form.invitationCode.placeholder")}
              disabled={loading}
              className="pl-9 font-mono uppercase"
              data-cy="auth-invitation-code-input"
            />
          </div>
          <p className="text-xs text-muted-foreground">{t("auth.signup.form.invitationCode.hint")}</p>
          {errors.invitationCode && <p className="text-sm text-destructive">{errors.invitationCode[0]}</p>}
        </div>

        <Button
          type="submit"
          className="w-full"
          loading={loading}
          disabled={backendUnavailable}
          data-cy="auth-submit-btn"
        >
          {loading ? t("auth.signup.form.creatingAccount") : t("auth.signup.form.createButton")}
        </Button>
      </form>
    </AuthShell>
  )
}
