"use client"

import { CheckCircle2, Copy, Plus, ShieldAlert, ShieldCheck, Trash2, XCircle } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { authenticatedFetch, useDelete, useGet, usePost, usePut } from "@/hooks/use-fetch"
import { useMutationWithToast } from "@/hooks/use-mutation-with-toast"
import {
  SettingsFormFooter,
  SettingsIconDisc,
  SettingsList,
  SettingsListRow,
  SettingsPage,
  SettingsRowMenu,
  SettingsSection,
} from "./settings-section"

/**
 * One claimed domain and its verification state — the exact shape
 * `backend/src/modules/company/sso/sso.service.ts`'s `SsoDomainStatus` returns. `recordName`/
 * `recordValue` are never secret: they are meant to be published in PUBLIC DNS by design, which is why
 * they are returned (and safe to render) even for an already-verified domain.
 */
interface SsoDomainStatus {
  id: string
  domain: string
  verified: boolean
  recordName: string
  recordValue: string
}

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
  domains: SsoDomainStatus[]
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

  const [newDomain, setNewDomain] = useState("")
  // Per-row loading flags, keyed by domain claim id — several rows can be in flight independently
  // (verifying one while removing another), unlike the single provider-wide `saving`/`removing` above.
  const [verifyingId, setVerifyingId] = useState<string | null>(null)
  const [removingDomainId, setRemovingDomainId] = useState<string | null>(null)

  const { trigger: addDomain, loading: addingDomain } = useMutationWithToast(
    usePost("/api/company/sso/domains"),
    t("settings.sso.domains.messages.addError", "Failed to claim the domain"),
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

  const handleAddDomain = async () => {
    const domain = newDomain.trim()
    if (!domain) return
    const result = await addDomain({ domain })
    if (!result) return // error already toasted by the wrapper
    toast.success(
      t("settings.sso.domains.messages.addSuccess", "Domain claimed — publish the DNS record to verify it"),
    )
    setNewDomain("")
    mutate()
  }

  /** Extracts the backend's own actionable message (e.g. "publish this exact TXT record") when there
   * is one, rather than a generic fallback — Nest's default exception filter body is
   * `{ statusCode, message, error }`, and every 4xx this screen can receive was written to name
   * exactly what the caller should do next (see `sso.service.ts#verifyDomain`). */
  const messageFrom = async (res: Response, fallback: string): Promise<string> => {
    try {
      const body = await res.json()
      return typeof body?.message === "string" ? body.message : fallback
    } catch {
      return fallback
    }
  }

  const handleVerifyDomain = async (id: string) => {
    setVerifyingId(id)
    try {
      const backendUrl = import.meta.env.VITE_BACKEND_URL || ""
      const res = await authenticatedFetch(`${backendUrl}/api/company/sso/domains/${id}/verify`, {
        method: "POST",
      })
      if (res.ok) {
        toast.success(t("settings.sso.domains.messages.verifySuccess", "Domain verified"))
        mutate()
      } else {
        toast.error(
          await messageFrom(
            res,
            t(
              "settings.sso.domains.messages.verifyError",
              "Verification failed. Publish the DNS record below and try again.",
            ),
          ),
        )
      }
    } catch {
      toast.error(
        t(
          "settings.sso.domains.messages.verifyError",
          "Verification failed. Publish the DNS record below and try again.",
        ),
      )
    } finally {
      setVerifyingId(null)
    }
  }

  const handleRemoveDomain = async (id: string) => {
    setRemovingDomainId(id)
    try {
      const backendUrl = import.meta.env.VITE_BACKEND_URL || ""
      const res = await authenticatedFetch(`${backendUrl}/api/company/sso/domains/${id}`, {
        method: "DELETE",
      })
      if (res.ok) {
        mutate()
      } else {
        toast.error(t("settings.sso.domains.messages.removeError", "Failed to remove the domain"))
      }
    } catch {
      toast.error(t("settings.sso.domains.messages.removeError", "Failed to remove the domain"))
    } finally {
      setRemovingDomainId(null)
    }
  }

  const directLink = provider ? `/auth/sign-in?sso=${provider.providerId}` : ""

  const active = isConfigured && provider?.isActive === true
  // Three real states, none fabricated: no provider at all, a provider that is ACTIVE (the normal,
  // working case), and a provider saved but turned inactive (a genuine "needs attention" state — this
  // screen always saves `isActive: true`, but a provider can still end up inactive some other way).
  const statusVariant = active ? "success" : isConfigured ? "warning" : "secondary"
  const StatusIcon = active ? CheckCircle2 : XCircle
  const statusIconTone = active
    ? "text-success-foreground"
    : isConfigured
      ? "text-warning-foreground"
      : "text-muted-foreground"

  return (
    <SettingsPage
      title={t("settings.sso.title", "Single sign-on (SSO)")}
      description={t(
        "settings.sso.description",
        "Let your team sign in with your own identity provider over OpenID Connect, instead of a password here.",
      )}
      dataCy="sso-section"
    >
      <SettingsSection
        title={
          <>
            <StatusIcon className={`size-4 shrink-0 ${statusIconTone}`} aria-hidden="true" />
            {provider?.label ?? t("settings.sso.title", "Single sign-on (SSO)")}
          </>
        }
        aside={
          <>
            <Badge variant={statusVariant} data-cy="sso-status">
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
          </>
        }
        footer={
          isConfigured && (
            <div className="flex items-center gap-2">
              {!editing && (
                <Button variant="outline" size="sm" onClick={() => setEditing(true)} dataCy="sso-edit-button">
                  {t("settings.sso.actions.edit", "Edit")}
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={handleRemove}
                loading={removing}
                dataCy="sso-remove-button"
              >
                {t("settings.sso.actions.remove", "Remove")}
              </Button>
            </div>
          )
        }
        dataCy="sso-status-card"
      >
        <div className="space-y-4">
          {/* Needed BEFORE anything is configured — it is what the customer registers at their IdP in
              order to create the application in the first place — so it is always shown. */}
          <div className="space-y-1.5">
            <Label htmlFor="sso-redirect-uri">{t("settings.sso.redirectUri.label", "Redirect URI")}</Label>
            <div className="flex items-center gap-2">
              <Input
                id="sso-redirect-uri"
                readOnly
                value={redirectUri}
                className="font-mono text-xs"
                data-cy="sso-redirect-uri"
              />
              <Button
                variant="outline"
                size="icon"
                tooltip={t("settings.sso.actions.copy", "Copy")}
                aria-label={t("settings.sso.actions.copy", "Copy")}
                onClick={() => copy(redirectUri)}
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
                <Input
                  id="sso-direct-link"
                  readOnly
                  value={directLink}
                  className="font-mono text-xs"
                  data-cy="sso-direct-link"
                />
                <Button
                  variant="outline"
                  size="icon"
                  tooltip={t("settings.sso.actions.copy", "Copy")}
                  aria-label={t("settings.sso.actions.copy", "Copy")}
                  onClick={() => copy(directLink)}
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
        </div>
      </SettingsSection>

      {provider && (
        <SettingsSection
          title={t("settings.sso.domains.title", "Email domains")}
          description={t(
            "settings.sso.domains.description",
            "Prove ownership of a domain via a DNS TXT record so matching sign-ins are routed here automatically. Until a domain is verified, the direct sign-in link above is the only way in.",
          )}
          footer={
            <div className="flex items-center gap-2">
              <Input
                placeholder={t("settings.sso.domains.addPlaceholder", "acme.com")}
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
                className="flex-1"
                data-cy="sso-domain-add-input"
              />
              <Button
                variant="outline"
                onClick={handleAddDomain}
                loading={addingDomain}
                disabled={!newDomain.trim()}
                dataCy="sso-domain-add-button"
              >
                <Plus className="h-4 w-4" />
                {t("settings.sso.domains.actions.add", "Claim domain")}
              </Button>
            </div>
          }
          dataCy="sso-domains-card"
        >
          {provider.domains.length === 0 ? (
            <EmptyState
              icon={ShieldAlert}
              size="sm"
              title={t("settings.sso.domains.empty", "No domain claimed yet.")}
              data-cy="sso-domains-empty"
            />
          ) : (
            <SettingsList>
              {provider.domains.map((domainStatus) => (
                <SettingsListRow
                  key={domainStatus.id}
                  dataCy="sso-domain-row"
                  leading={
                    <SettingsIconDisc
                      icon={domainStatus.verified ? ShieldCheck : ShieldAlert}
                      tone={domainStatus.verified ? "success" : "default"}
                    />
                  }
                  badge={
                    <Badge variant={domainStatus.verified ? "success" : "secondary"}>
                      {domainStatus.verified
                        ? t("settings.sso.domains.status.verified", "Verified")
                        : t("settings.sso.domains.status.pending", "Pending")}
                    </Badge>
                  }
                  title={<span data-cy="sso-domain-name">{domainStatus.domain}</span>}
                  primary={
                    !domainStatus.verified ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleVerifyDomain(domainStatus.id)}
                        loading={verifyingId === domainStatus.id}
                        dataCy="sso-domain-verify-button"
                      >
                        {t("settings.sso.domains.actions.verify", "Verify")}
                      </Button>
                    ) : undefined
                  }
                  menu={
                    <SettingsRowMenu
                      dataCy="sso-domain-menu"
                      items={[
                        {
                          label: t("settings.sso.domains.actions.remove", "Remove domain"),
                          icon: Trash2,
                          onSelect: () => handleRemoveDomain(domainStatus.id),
                          disabled: removingDomainId === domainStatus.id,
                          destructive: true,
                          dataCy: "sso-domain-remove-button",
                        },
                      ]}
                    />
                  }
                >
                  {!domainStatus.verified && (
                    <div className="space-y-1.5 text-xs text-muted-foreground">
                      <p>
                        {t(
                          "settings.sso.domains.instructions",
                          "Publish this DNS TXT record, then click Verify.",
                        )}
                      </p>
                      <div className="flex items-center gap-2">
                        <Input
                          readOnly
                          value={domainStatus.recordName}
                          className="font-mono text-xs"
                          data-cy="sso-domain-record-name"
                        />
                        <Button
                          variant="outline"
                          size="icon"
                          tooltip={t("settings.sso.actions.copy", "Copy")}
                          aria-label={t("settings.sso.actions.copy", "Copy")}
                          onClick={() => copy(domainStatus.recordName)}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="flex items-center gap-2">
                        <Input
                          readOnly
                          value={domainStatus.recordValue}
                          className="font-mono text-xs"
                          data-cy="sso-domain-record-value"
                        />
                        <Button
                          variant="outline"
                          size="icon"
                          tooltip={t("settings.sso.actions.copy", "Copy")}
                          aria-label={t("settings.sso.actions.copy", "Copy")}
                          onClick={() => copy(domainStatus.recordValue)}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </SettingsListRow>
              ))}
            </SettingsList>
          )}
        </SettingsSection>
      )}

      {showForm && (
        <SettingsSection
          title={
            isConfigured
              ? t("settings.sso.form.editTitle", "Update the identity provider")
              : t("settings.sso.form.createTitle", "Connect an identity provider")
          }
          description={t(
            "settings.sso.form.description",
            "Credentials are encrypted before they are stored and are never shown again, so re-enter them when you edit.",
          )}
          footer={
            <SettingsFormFooter>
              {isConfigured && (
                <Button
                  type="button"
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
              <Button size="sm" onClick={handleSave} loading={saving} dataCy="sso-save-button">
                {t("settings.sso.actions.save", "Save")}
              </Button>
            </SettingsFormFooter>
          }
          dataCy="sso-form-card"
        >
          <div className="grid gap-4 sm:grid-cols-2">
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
                  <p className="text-xs text-muted-foreground">{t(field.hintKey, field.hintDefault ?? "")}</p>
                )}
              </div>
            ))}
          </div>
        </SettingsSection>
      )}
    </SettingsPage>
  )
}
