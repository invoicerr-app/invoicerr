import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { EyeClosedIcon, EyeIcon, Fingerprint } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ServerUnavailableBanner } from "@/components/server-unavailable-banner"
import type React from "react"
import { authClient } from "@/lib/auth"
import { envOidcProviderId, getEnvVariable, isOidcOnly } from "@/lib/runtime-config"
import { toast } from "sonner"
import { useBackendHealth } from "@/hooks/use-backend-health"
import { useState } from "react"
import { useSearchParams } from "react-router"
import { useTranslation } from "react-i18next"

export default function LoginPage() {
  const { t } = useTranslation()

  const [errors] = useState<Record<string, string[]>>({})
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const backendHealth = useBackendHealth()
  const backendUnavailable = backendHealth === "unavailable"

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

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    setLoading(true)

    const result = await authClient.signIn.email({
      email: (event.currentTarget.elements.namedItem("email") as HTMLInputElement).value,
      password: (event.currentTarget.elements.namedItem("password") as HTMLInputElement).value,
      rememberMe: true,
    })

    if (result.error) {
      toast.error(result.error.message || t("auth.login.messages.loginError"))
    }

    if (result.data?.user.createdAt) {
      toast.success(t("auth.login.messages.loginSuccess"))
      // Force a full page reload to refresh the session state
      window.location.href = "/dashboard"
      return
    }

    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <Card className="w-full max-w-sm md:max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl text-center">{t("auth.login.title")}</CardTitle>
          <CardDescription className="text-center">{t("auth.login.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          {backendUnavailable && <ServerUnavailableBanner />}

          {/* A provider named by the link, or found from the address typed below. Offered above the
              form: someone arriving on their company's own link should not have to read past a
              password field they do not have. */}
          {(ssoFromLink || discoveredSso) && (
            <Button
              type="button"
              className="w-full mb-4"
              disabled={backendUnavailable}
              onClick={() => signInWithProvider(discoveredSso?.providerId ?? ssoFromLink!)}
              data-cy="auth-sso-btn"
            >
              <Fingerprint className="h-4 w-4" />
              {discoveredSso
                ? t("auth.login.sso.button", "Sign in with {{label}}", { label: discoveredSso.label })
                : t("auth.login.sso.direct", "Continue with single sign-on")}
            </Button>
          )}

          {oidcOnly ? (
            <p className="text-sm text-muted-foreground text-center" data-cy="auth-oidc-only-notice">
              {t("auth.login.sso.oidcOnly", "This instance uses single sign-on only.")}
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">{t("auth.login.form.email.label")}</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  disabled={loading}
                  data-cy="auth-email-input"
                  onBlur={(e) => lookupSso(e.target.value)}
                />
                {errors.email && (
                  <p className="text-sm text-red-600" data-cy="auth-email-error">
                    {errors.email[0]}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">{t("auth.login.form.password.label")}</Label>
                <div className="flex items-center justify-between gap-2">
                  <Input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    disabled={loading}
                    data-cy="auth-password-input"
                  />
                  <Button type="button" variant="outline" onClick={() => setShowPassword((prev) => !prev)}>
                    {showPassword ? <EyeClosedIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
                  </Button>
                </div>
                {errors.password && <p className="text-sm text-red-600">{errors.password[0]}</p>}
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={loading || backendUnavailable}
                data-cy="auth-submit-btn"
              >
                {loading ? t("auth.login.form.loggingIn") : t("auth.login.form.loginButton")}
              </Button>
            </form>
          )}

          <section className="flex flex-col mt-4 gap-1">
            {/* No point offering account creation on an instance where an account can only come from
                an identity provider. */}
            {!oidcOnly && (
              <div className="text-center text-sm">
                {t("auth.login.noAccount")}{" "}
                <a href="/auth/sign-up" className="underline hover:text-primary" data-cy="auth-signup-link">
                  {t("auth.login.signUpLink")}
                </a>
              </div>
            )}
            {envProviderId && (
              <div className="text-center text-sm">
                {t("auth.login.oidc")}{" "}
                <Button
                  variant="link"
                  onClick={() => signInWithProvider(envProviderId)}
                  className="underline hover:text-primary p-0"
                >
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
