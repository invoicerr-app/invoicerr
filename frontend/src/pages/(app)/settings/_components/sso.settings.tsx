"use client"

import { CheckCircle2, Copy, Fingerprint, Loader2, XCircle } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useDelete, useGet, usePut } from "@/hooks/use-fetch"
import { useMutationWithToast } from "@/hooks/use-mutation-with-toast"

/**
 * Status only — the exact shape `backend/src/modules/company/sso/sso.service.ts`'s
 * `SsoProviderStatus` returns. No credential field exists to render, because none is ever sent: the
 * PUT body is encrypted at rest server-side and never echoed back, so "Edit" always starts blank.
 */
interface SsoProviderStatus {
  providerId: string
  label: string
  issuerHost: string | null
  isActive: boolean
  redirectUri: string
  domainsVerified: boolean
  emailDomains: string[]
}

interface SsoResponse {
  provider: SsoProviderStatus | null
  redirectUri: string
}

/**
 * One configuration field. The same field-spec approach `channels.settings.tsx` uses: the form is
 * DATA, so adding a field is one entry here rather than another branch in the render function — and a
 * `password` field is never pre-filled from a response, because no response carries one.
 */
interface SsoFieldSpec {
  key: string
  labelKey: string
  labelDefault: string
  type: "text" | "password"
  placeholder?: string
  /** Required unless the row is satisfied another way — see `endpointsSatisfied` below. */
  optional?: boolean
  hintKey?: string
  hintDefault?: string
}

const FIELDS: SsoFieldSpec[] = [
  {
    key: "label",
    labelKey: "settings.sso.fields.label",
    labelDefault: "Display name",
    type: "text",
    placeholder: "Acme SSO",
  },
  {
    key: "discoveryUrl",
    labelKey: "settings.sso.fields.discoveryUrl",
    labelDefault: "Discovery URL (.well-known/openid-configuration)",
    type: "text",
    placeholder: "https://idp.acme.com/.well-known/openid-configuration",
    optional: true,
    hintKey: "settings.sso.fields.discoveryUrlHint",
    hintDefault: "Recommended. With this, the endpoints below are discovered automatically.",
  },
  {
    key: "authorizationUrl",
    labelKey: "settings.sso.fields.authorizationUrl",
    labelDefault: "Authorization URL",
    type: "text",
    placeholder: "https://idp.acme.com/authorize",
    optional: true,
  },
  {
    key: "tokenUrl",
    labelKey: "settings.sso.fields.tokenUrl",
    labelDefault: "Token URL",
    type: "text",
    placeholder: "https://idp.acme.com/token",
    optional: true,
  },
  {
    key: "userInfoUrl",
    labelKey: "settings.sso.fields.userInfoUrl",
    labelDefault: "User info URL",
    type: "text",
    placeholder: "https://idp.acme.com/userinfo",
    optional: true,
  },
  { key: "clientId", labelKey: "settings.sso.fields.clientId", labelDefault: "Client ID", type: "text" },
  {
    key: "clientSecret",
    labelKey: "settings.sso.fields.clientSecret",
    labelDefault: "Client secret",
    type: "password",
    optional: true,
    hintKey: "settings.sso.fields.clientSecretHint",
    hintDefault: "Leave blank only for a public client using PKCE.",
  },
  {
    key: "emailDomains",
    labelKey: "settings.sso.fields.emailDomains",
    labelDefault: "Email domains (comma separated)",
    type: "text",
    placeholder: "acme.com, acme.fr",
    optional: true,
  },
]

const emptyForm = () => Object.fromEntries(FIELDS.map((field) => [field.key, ""])) as Record<string, string>

/** Either a discovery URL, or an authorization URL and a token URL — what the backend also enforces. */
const endpointsSatisfied = (form: Record<string, string>) =>
  form.discoveryUrl?.trim() ? true : Boolean(form.authorizationUrl?.trim() && form.tokenUrl?.trim())

/**
 * Company settings -> SSO (`/settings/sso`) — a customer registering ITS OWN OIDC provider, so its
 * people sign in with their existing corporate identity instead of a password here.
 *
 * The company id is never in a URL this screen builds: every call is scoped to the caller's active
 * company server-side (`@ActiveCompany()`). What the screen DOES show is the redirect URI the customer
 * must register at their identity provider — it is fully determined by the company, because the
 * provider id is "c_<companyId>" and better-auth's callback route is /callback/:id.
 */
export default function SsoSettings() {
  const { t } = useTranslation()
  const { data, mutate } = useGet<SsoResponse>("/api/company/sso")
  const provider = data?.provider ?? null
  const redirectUri = data?.redirectUri ?? provider?.redirectUri ?? ""

  const [form, setForm] = useState<Record<string, string>>(emptyForm)
  const [editing, setEditing] = useState(false)

  const { trigger: save, loading: saving } = useMutationWithToast(
    usePut("/api/company/sso"),
    t("settings.sso.messages.saveError", "Failed to save the SSO configuration"),
  )
  const { trigger: remove, loading: removing } = useMutationWithToast(
    useDelete("/api/company/sso"),
    t("settings.sso.messages.removeError", "Failed to remove the SSO configuration"),
  )

  const isConfigured = Boolean(provider)
  const showForm = editing || !isConfigured

  const handleSave = async () => {
    if (!form.clientId?.trim()) {
      toast.error(
        t("settings.sso.messages.fieldsRequired", "{{field}} is required", {
          field: t("settings.sso.fields.clientId", "Client ID"),
        }),
      )
      return
    }
    if (!endpointsSatisfied(form)) {
      toast.error(
        t(
          "settings.sso.messages.endpointsRequired",
          "Provide a discovery URL, or both an authorization URL and a token URL.",
        ),
      )
      return
    }

    const result = await save({ ...form, isActive: true })
    if (!result) return // error already toasted by the wrapper
    toast.success(t("settings.sso.messages.saveSuccess", "SSO configuration saved"))
    // Never keep a secret in component state once it has been sent.
    setForm(emptyForm())
    setEditing(false)
    mutate()
  }

  const handleRemove = async () => {
    const result = await remove()
    if (!result) return
    toast.success(t("settings.sso.messages.removeSuccess", "SSO configuration removed"))
    setForm(emptyForm())
    setEditing(false)
    mutate()
  }

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      toast.success(t("settings.sso.messages.copied", "Copied to clipboard"))
    } catch {
      // A clipboard permission refusal is not an error worth a red toast: the value is on screen and
      // selectable either way.
    }
  }

  const directLink = provider ? `/auth/sign-in?sso=${provider.providerId}` : ""

  return (
    <div className="space-y-6" data-cy="sso-section">
      <div>
        <h1 className="text-2xl font-bold mb-2">{t("settings.sso.title", "Single sign-on (SSO)")}</h1>
        <p className="text-muted-foreground">
          {t(
            "settings.sso.description",
            "Let your team sign in with your own identity provider over OpenID Connect, instead of a password here.",
          )}
        </p>
      </div>

      <Card data-cy="sso-status-card">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {isConfigured && provider?.isActive ? (
                <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
              ) : (
                <XCircle className="h-5 w-5 text-muted-foreground shrink-0" />
              )}
              <CardTitle className="text-base">
                {provider?.label ?? t("settings.sso.title", "Single sign-on (SSO)")}
              </CardTitle>
              <Badge
                variant={isConfigured && provider?.isActive ? "default" : "secondary"}
                data-cy="sso-status"
              >
                {isConfigured
                  ? provider?.isActive
                    ? t("settings.sso.status.configured", "Active")
                    : t("settings.sso.status.inactive", "Inactive")
                  : t("settings.sso.status.notConfigured", "Not configured")}
              </Badge>
              {provider?.issuerHost && (
                <Badge variant="outline" data-cy="sso-issuer">
                  {t("settings.sso.issuer", "Issuer: {{host}}", { host: provider.issuerHost })}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              {isConfigured && !editing && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditing(true)}
                  data-cy="sso-edit-button"
                >
                  {t("settings.sso.actions.edit", "Edit")}
                </Button>
              )}
              {isConfigured && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={handleRemove}
                  disabled={removing}
                  data-cy="sso-remove-button"
                >
                  {removing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    t("settings.sso.actions.remove", "Remove")
                  )}
                </Button>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Needed BEFORE anything is configured — it is what the customer registers at their IdP in
              order to create the application in the first place — so it is always shown. */}
          <div className="space-y-1.5">
            <Label htmlFor="sso-redirect-uri">{t("settings.sso.redirectUri.label", "Redirect URI")}</Label>
            <div className="flex items-center gap-2">
              <Input id="sso-redirect-uri" readOnly value={redirectUri} data-cy="sso-redirect-uri" />
              <Button
                variant="outline"
                size="icon"
                onClick={() => copy(redirectUri)}
                aria-label={t("settings.sso.actions.copy", "Copy")}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t(
                "settings.sso.redirectUri.hint",
                "Register this exact URL as the redirect/callback URI at your identity provider.",
              )}
            </p>
          </div>

          {provider && (
            <div className="space-y-1.5">
              <Label htmlFor="sso-direct-link">
                {t("settings.sso.directLink.label", "Direct sign-in link")}
              </Label>
              <div className="flex items-center gap-2">
                <Input id="sso-direct-link" readOnly value={directLink} data-cy="sso-direct-link" />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => copy(directLink)}
                  aria-label={t("settings.sso.actions.copy", "Copy")}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {t(
                  "settings.sso.directLink.hint",
                  "Share this link with your team: it offers your provider straight away, with no email lookup.",
                )}
              </p>
            </div>
          )}

          {provider && provider.emailDomains.length > 0 && !provider.domainsVerified && (
            <div className="rounded-md bg-muted p-3">
              <p className="text-sm text-muted-foreground" data-cy="sso-domains-unverified">
                {t(
                  "settings.sso.status.domainsUnverified",
                  "Your email domains are recorded but NOT verified, so they are not used to route anyone automatically. Share the direct sign-in link above instead.",
                )}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {showForm && (
        <Card data-cy="sso-form-card">
          <CardHeader>
            <CardTitle className="text-base">
              {isConfigured
                ? t("settings.sso.form.editTitle", "Update the identity provider")
                : t("settings.sso.form.createTitle", "Connect an identity provider")}
            </CardTitle>
            <CardDescription>
              {t(
                "settings.sso.form.description",
                "Credentials are encrypted before they are stored and are never shown again, so re-enter them when you edit.",
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {FIELDS.map((field) => (
                <div className="space-y-1.5" key={field.key}>
                  <Label htmlFor={`sso-${field.key}`}>{t(field.labelKey, field.labelDefault)}</Label>
                  <Input
                    id={`sso-${field.key}`}
                    data-cy={`sso-${field.key.toLowerCase()}-input`}
                    type={field.type}
                    placeholder={field.placeholder}
                    value={form[field.key] ?? ""}
                    onChange={(e) => setForm((prev) => ({ ...prev, [field.key]: e.target.value }))}
                  />
                  {field.hintKey && (
                    <p className="text-xs text-muted-foreground">
                      {t(field.hintKey, field.hintDefault ?? "")}
                    </p>
                  )}
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              {isConfigured && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setForm(emptyForm())
                    setEditing(false)
                  }}
                >
                  {t("settings.sso.actions.cancel", "Cancel")}
                </Button>
              )}
              <Button size="sm" onClick={handleSave} disabled={saving} data-cy="sso-save-button">
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  t("settings.sso.actions.save", "Save")
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {!isConfigured && !showForm && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-8">
            <Fingerprint className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground text-center">
              {t("settings.sso.emptyState", "No identity provider connected yet")}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
