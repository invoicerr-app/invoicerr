import { Check, CircleAlert, Copy, Fingerprint, Info } from "lucide-react"
import type React from "react"
import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useSearchParams } from "react-router"
import { toast } from "sonner"

import { AuthLink, AuthSeparator, AuthShell } from "@/pages/auth/_components/auth-shell"
import { PasswordInput } from "@/pages/auth/_components/password-input"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LegalLinks } from "@/components/legal-links"
import { ServerUnavailableBanner } from "@/components/server-unavailable-banner"
import { authClient } from "@/lib/auth"
import { copyToClipboard } from "@/lib/clipboard"
import { hasSignedOutInThisTab } from "@/lib/sign-out"
import { envOidcProviderId, getEnvVariable, isOidcOnly } from "@/lib/runtime-config"
import { useBackendHealth } from "@/hooks/use-backend-health"
import { type DemoInstanceView, useDemoMode, useRegistrationStatus } from "@/hooks/queries"

function CopyValueButton({ value, label }: Readonly<{ value: string; label: string }>) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-8 text-muted-foreground"
      aria-label={copied ? t("demo.signIn.copied") : label}
      onClick={async () => {
        if (!(await copyToClipboard(value))) return
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
    >
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
    </Button>
  )
}

function DemoCredentialsNotice({
  demo,
  onTry,
  loading,
}: Readonly<{ demo: DemoInstanceView; onTry: () => void; loading: boolean }>) {
  const { t } = useTranslation()
  return (
    <section
      className="rounded-xl border border-dashed border-primary bg-card/60 p-4"
      aria-labelledby="demo-credentials-title"
      data-cy="demo-credentials-notice"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2
          id="demo-credentials-title"
          className="inline-flex items-center gap-1.5 rounded-full bg-info px-2.5 py-0.5 font-sans text-[13px] font-semibold text-info-foreground"
        >
          <Info className="size-3.5" aria-hidden="true" />
          {t("demo.signIn.title", "This is a public demo")}
        </h2>
        <p className="text-[13.5px] text-muted-foreground">
          {t("demo.signIn.resets", { count: demo.resetIntervalHours })}
        </p>
      </div>
      <p className="mt-2 text-[13.5px] text-ink-2">{t("demo.signIn.description")}</p>
      <dl className="mt-2 divide-y border-y text-sm">
        <div className="grid grid-cols-[7rem_1fr_auto] items-center gap-2 py-1">
          <dt className="text-muted-foreground">{t("auth.login.form.email.label")}</dt>
          <dd className="font-semibold text-foreground select-all" data-cy="demo-credentials-email">
            {demo.email}
          </dd>
          <CopyValueButton value={demo.email} label={t("demo.signIn.copyEmail")} />
        </div>
        <div className="grid grid-cols-[7rem_1fr_auto] items-center gap-2 py-1">
          <dt className="text-muted-foreground">{t("auth.login.form.password.label")}</dt>
          <dd className="font-semibold text-foreground select-all" data-cy="demo-credentials-password">
            {demo.password}
          </dd>
          <CopyValueButton value={demo.password} label={t("demo.signIn.copyPassword")} />
        </div>
      </dl>
      <Button
        type="button"
        className="mt-3 w-full"
        loading={loading}
        onClick={onTry}
        data-cy="demo-try-button"
      >
        {t("demo.signIn.tryButton")}
      </Button>
    </section>
  )
}

type SignInError = { title: string; description: string }

export default function LoginPage() {
  const { t } = useTranslation()

  const [loading, setLoading] = useState(false)
  const [signInError, setSignInError] = useState<SignInError | null>(null)
  const backendHealth = useBackendHealth()
  const backendUnavailable = backendHealth === "unavailable"
  const { demo } = useDemoMode()
  const { data: registration, isPending: registrationPending } = useRegistrationStatus()
  // Kept on an invitation-only instance: the sign-up page is where an invitee types their code.
  // Hidden until the server answers, so a closed instance never flashes it; a failed check keeps it.
  const hideSignupLink =
    registrationPending || (registration?.allowed === false && !registration.requiresCode)

  const [searchParams] = useSearchParams()
  // The direct link a company hands its own people: /auth/sign-in?sso=c_<companyId>. No lookup, no
  // email typed — the provider is named outright, which is what actually gets a customer's users in
  // today (the email-first lookup below only matches VERIFIED domains, and nothing verifies them yet).
  const ssoFromLink = searchParams.get("sso")
  // Discovered from the address typed below, if that address belongs to a company whose SSO domains
  // have been verified. Null the rest of the time, which is currently always.
  const [discoveredSso, setDiscoveredSso] = useState<{ providerId: string; label: string } | null>(null)

  const oidcOnly = isOidcOnly()
  const envProviderId = envOidcProviderId()

  const signInWithProvider = (provider: string) => {
    // The generic OIDC providers are driven by the CORE social sign-in: since better-auth 1.7 the
    // generic-OAuth plugin has no endpoints of its own. `provider` is the id the backend registered —
    // the instance-wide one (`VITE_OIDC_PROVIDER_ID`, published by entrypoint.sh only when the backend
    // actually registered it) or a per-company one ("c_<companyId>").
    authClient.signIn.social({ provider, callbackURL: "/dashboard" })
  }

  const lookupSso = async (email: string) => {
    if (!email.includes("@")) {
      setDiscoveredSso(null)
      return
    }
    try {
      const backendUrl = getEnvVariable("VITE_BACKEND_URL") || ""
      const response = await fetch(`${backendUrl}/api/sso/lookup?email=${encodeURIComponent(email)}`)
      // 204 means "no provider for this address" — the ordinary answer, not a failure. Any other
      // non-OK response is not worth surfacing on a sign-in page either: password sign-in still works.
      if (response.status === 204 || !response.ok) {
        setDiscoveredSso(null)
        return
      }
      setDiscoveredSso(await response.json())
    } catch {
      setDiscoveredSso(null)
    }
  }

  const signInWithPassword = useCallback(
    async (email: string, password: string) => {
      setLoading(true)
      setSignInError(null)

      const result = await authClient.signIn.email({ email, password, rememberMe: true })

      if (result.error) {
        setSignInError(
          result.error.code === "INVALID_ORIGIN"
            ? {
                title: t("auth.login.messages.invalidOriginTitle"),
                description: t("auth.login.messages.invalidOrigin", { origin: window.location.origin }),
              }
            : {
                title: t("auth.login.messages.loginErrorTitle"),
                description: result.error.message || t("auth.login.messages.loginError"),
              },
        )
        setLoading(false)
        return
      }

      // A 200 does not mean the browser stored the session cookie (a Secure cookie over http is dropped).
      const session = await authClient.getSession()
      if (!session.data) {
        setSignInError({
          title: t("auth.login.messages.sessionNotStoredTitle"),
          description: t("auth.login.messages.sessionNotStored"),
        })
        setLoading(false)
        return
      }

      toast.success(t("auth.login.messages.loginSuccess"))
      // Force a full page reload to refresh the session state
      window.location.href = "/dashboard"
    },
    [t],
  )

  // Once per visit: a failure leaves the page as it is, with the error and the form.
  const autoSignInStarted = useRef(false)
  useEffect(() => {
    if (!demo || autoSignInStarted.current || hasSignedOutInThisTab()) return
    autoSignInStarted.current = true
    void signInWithPassword(demo.email, demo.password)
  }, [demo, signInWithPassword])

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const fields = event.currentTarget.elements
    void signInWithPassword(
      (fields.namedItem("email") as HTMLInputElement).value,
      (fields.namedItem("password") as HTMLInputElement).value,
    )
  }

  const footer = (
    <>
      {(!oidcOnly || envProviderId) && (
        <>
          {/* No point offering account creation on an instance where an account can only come from
            an identity provider. */}
          {!oidcOnly && !hideSignupLink && (
            <span className="text-muted-foreground">
              {t("auth.login.noAccount")}{" "}
              <AuthLink href="/auth/sign-up" dataCy="auth-signup-link">
                {t("auth.login.signUpLink")}
              </AuthLink>
            </span>
          )}
          {envProviderId && (
            <span className="text-muted-foreground">
              {t("auth.login.oidc")}{" "}
              <Button variant="link" onClick={() => signInWithProvider(envProviderId)} className="h-auto p-0">
                {t("auth.login.oidcLink")}
              </Button>
            </span>
          )}
        </>
      )}
      {/* See `components/legal-links.tsx`'s own header for why this sits inside the card's footer
          rather than genuinely below the card. */}
      <LegalLinks className="mt-1" />
    </>
  )

  return (
    <AuthShell
      title={t("auth.login.title")}
      description={t("auth.login.description")}
      footer={footer}
      dataCy="auth-card"
    >
      {backendUnavailable && <ServerUnavailableBanner />}
      {demo && (
        <DemoCredentialsNotice
          demo={demo}
          loading={loading}
          onTry={() => void signInWithPassword(demo.email, demo.password)}
        />
      )}
      {signInError && (
        <Alert variant="destructive" className="mb-4" data-cy="auth-signin-error">
          <CircleAlert />
          <AlertTitle>{signInError.title}</AlertTitle>
          <AlertDescription>{signInError.description}</AlertDescription>
        </Alert>
      )}

      {/* A provider named by the link, or found from the address typed below. Offered above the
          form: someone arriving on their company's own link should not have to read past a
          password field they do not have. */}
      {(ssoFromLink || discoveredSso) && (
        <>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={backendUnavailable}
            onClick={() => signInWithProvider(discoveredSso?.providerId ?? ssoFromLink!)}
            data-cy="auth-sso-btn"
          >
            <Fingerprint className="h-4 w-4" />
            {discoveredSso
              ? t("auth.login.sso.button", "Sign in with {{label}}", { label: discoveredSso.label })
              : t("auth.login.sso.direct", "Continue with single sign-on")}
          </Button>
          {!oidcOnly && <AuthSeparator />}
        </>
      )}

      {oidcOnly ? (
        <p className="text-center text-sm text-muted-foreground" data-cy="auth-oidc-only-notice">
          {t("auth.login.sso.oidcOnly", "This instance uses single sign-on only.")}
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">{t("auth.login.form.email.label")}</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              disabled={loading}
              data-cy="auth-email-input"
              onBlur={(e) => lookupSso(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">{t("auth.login.form.password.label")}</Label>
            <PasswordInput
              id="password"
              name="password"
              autoComplete="current-password"
              disabled={loading}
              data-cy="auth-password-input"
            />
          </div>
          <Button
            type="submit"
            className="w-full"
            loading={loading}
            disabled={backendUnavailable}
            data-cy="auth-submit-btn"
          >
            {loading ? t("auth.login.form.loggingIn") : t("auth.login.form.loginButton")}
          </Button>
        </form>
      )}
    </AuthShell>
  )
}
