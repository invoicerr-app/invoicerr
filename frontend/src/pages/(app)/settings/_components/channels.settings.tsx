"use client"

import { CheckCircle2, Loader2, Radio, XCircle } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useDocumentTransports } from "@/hooks/queries"
import { useGet, usePut, useDelete } from "@/hooks/use-fetch"
import { useMutationWithToast } from "@/hooks/use-mutation-with-toast"

type ChannelEnvironment = "TEST" | "PROD"

interface ChannelProvenance {
  kind: "legal" | "unverified"
  resolutionNote?: string
  sourceText?: string
  sourceCheckedAt?: string
}
interface ConfiguredChannel {
  providerId: string
  channel: string
  environment: ChannelEnvironment
  isActive: boolean
}
interface SuggestedChannel {
  providerId: string
  // Root TODO item 11 — a country's own policy on this channel: "suggested" is item 10's original,
  // non-binding hint; "mandated" (with `mandatedFrom`) means an invoice issued on or after that date
  // is REFUSED at the backend preflight if sent through anything else (see invoice-actions.ts's own
  // header). Both fields optional so a pre-item-11 response shape still type-checks — nothing here
  // assumes every provider entry has been through the new schema.
  requirement?: "suggested" | "mandated"
  mandatedFrom?: string
  provenance: ChannelProvenance
}
interface ChannelsResponse {
  configured: ConfiguredChannel[]
  suggested: SuggestedChannel[]
}

/** Friendly display names for known providers — `TransportRegistry.list()`'s own label ("PDP
 *  (France)") is written for the invoice-transport PICKER, not this settings screen; falls back to
 *  the bare id (uppercased) for a provider this screen has no opinion about yet. */
const PROVIDER_LABELS: Record<string, string> = { pdp: "PDP", ksef: "KSeF", sdi: "SdI" }

/**
 * One provider's config field — the settings-screen half of what wave 1 (PDP) had hard-coded
 * directly into `ChannelRow`'s own JSX. Item 10, wave 2 (KSeF/SdI) generalizes it: a THIRD PARTY
 * provider (this screen's `providerIds` already unions `TransportRegistry.list()` with whatever is
 * configured/suggested — see this file's own `ChannelsSettings` header) declares its config shape
 * HERE, once, rather than needing a new branch in the render function the way PDP's own fields used
 * to be. `environment` (TEST/PROD) is NOT one of these — it is already a generic, provider-agnostic
 * concept every `CompanyChannelConfig` row carries (see `channels.service.ts`'s own header), rendered
 * identically for every provider below.
 */
interface ChannelFieldSpec {
  /** The key this field is stored under in the encrypted `config` blob — e.g. "clientId". */
  key: string
  labelKey: string
  labelDefault: string
  type: "text" | "password"
  placeholder?: string
}

/** One entry per provider `TransportRegistry` can hand a company — see `ChannelFieldSpec`'s own
 *  header. Adding a FOURTH national channel is exactly one more entry here, never a new branch in
 *  `ChannelRow`'s render below. */
const PROVIDER_FIELDS: Record<string, ChannelFieldSpec[]> = {
  pdp: [
    {
      key: "baseUrl",
      labelKey: "settings.channels.fields.baseUrl",
      labelDefault: "API base URL",
      type: "text",
      placeholder: "https://api.superpdp.tech",
    },
    {
      key: "clientId",
      labelKey: "settings.channels.fields.clientId",
      labelDefault: "Client ID",
      type: "text",
    },
    {
      key: "clientSecret",
      labelKey: "settings.channels.fields.clientSecret",
      labelDefault: "Client secret",
      type: "password",
    },
  ],
  // KSeF (PL) — item 10, wave 2. `nip`/`ksefToken` are the ONLY provider-specific fields
  // `ksef-transport.ts#extractCredentials` reads; the environment selector below (generic, already
  // rendered for every provider) is what the transport reads as TEST/PROD.
  ksef: [
    {
      key: "nip",
      labelKey: "settings.channels.fields.ksefNip",
      labelDefault: "NIP",
      type: "text",
      placeholder: "5260001246",
    },
    {
      key: "ksefToken",
      labelKey: "settings.channels.fields.ksefToken",
      labelDefault: "KSeF token",
      type: "password",
    },
  ],
  // SdI (IT) — item 10, wave 2. Exactly the three fields `sdi-transport.ts#extractCredentials`
  // reads (idTrasmittente/certificate required to be "connected"; certificatePassword read through
  // when present — see that file's own header on why it isn't required here either).
  sdi: [
    {
      key: "idTrasmittente",
      labelKey: "settings.channels.fields.sdiIdTrasmittente",
      labelDefault: "IdTrasmittente",
      type: "text",
      placeholder: "IT01234567890",
    },
    {
      key: "certificate",
      labelKey: "settings.channels.fields.sdiCertificate",
      labelDefault: "PFX certificate (base64)",
      type: "password",
    },
    {
      key: "certificatePassword",
      labelKey: "settings.channels.fields.sdiCertificatePassword",
      labelDefault: "Certificate password",
      type: "password",
    },
  ],
}

/**
 * One channel's connect/disconnect card — item 10 (root TODO), now GENERIC by provider (wave 1 hard-
 * coded PDP's own three fields directly here; wave 2 needed a second and third shape, KSeF's and
 * SdI's, so the field LIST moved to `PROVIDER_FIELDS` above and this component only ever renders
 * whatever that list declares — no branch on `providerId` anywhere in this function). `GET/PUT/DELETE
 * /api/company/channels/:providerId` (`modules/company/channels/`): the PUT body is encrypted at rest
 * server-side and NEVER echoed back — see `channels.service.ts`'s own header — so this component
 * never has a decrypted secret to pre-fill an edit form with; "Edit" always starts blank.
 */
function ChannelRow({
  providerId,
  configured,
  suggested,
  onChanged,
}: {
  providerId: string
  configured?: ConfiguredChannel
  suggested?: SuggestedChannel
  onChanged: () => void
}) {
  const { t } = useTranslation()
  const fields = PROVIDER_FIELDS[providerId] ?? []
  const [config, setConfig] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, ""])),
  )
  const [environment, setEnvironment] = useState<ChannelEnvironment>("TEST")
  const [editing, setEditing] = useState(!configured?.isActive)

  const isConnected = !!configured?.isActive

  const { trigger: upsert, loading: connecting } = useMutationWithToast(
    usePut(`/api/company/channels/${providerId}`),
    t("settings.channels.messages.connectError", "Failed to connect the channel"),
  )
  const { trigger: disconnectChannel, loading: disconnecting } = useMutationWithToast(
    useDelete(`/api/company/channels/${providerId}`),
    t("settings.channels.messages.disconnectError", "Failed to disconnect the channel"),
  )

  const handleConnect = async () => {
    const missing = fields.filter((f) => !config[f.key]?.trim())
    if (missing.length > 0) {
      toast.error(
        t("settings.channels.messages.fieldsRequired", "{{fields}} are all required", {
          fields: fields.map((f) => t(f.labelKey, f.labelDefault)).join(", "),
        }),
      )
      return
    }
    const result = await upsert({ environment, config })
    if (!result) return // error already toasted by the wrapper
    toast.success(t("settings.channels.messages.connectSuccess", "Channel connected"))
    setConfig(Object.fromEntries(fields.map((f) => [f.key, ""])))
    setEditing(false)
    onChanged()
  }

  const handleDisconnect = async () => {
    const result = await disconnectChannel()
    if (!result) return // error already toasted by the wrapper
    toast.success(t("settings.channels.messages.disconnectSuccess", "Channel disconnected"))
    setEditing(true)
    onChanged()
  }

  const label = PROVIDER_LABELS[providerId] ?? providerId.toUpperCase()

  return (
    <Card data-cy={`channel-${providerId}`}>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {isConnected ? (
              <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
            ) : (
              <XCircle className="h-5 w-5 text-muted-foreground shrink-0" />
            )}
            <CardTitle className="text-base">{label}</CardTitle>
            <Badge variant={isConnected ? "default" : "secondary"} data-cy={`channel-${providerId}-status`}>
              {isConnected
                ? t("settings.channels.status.connected", "Connected ({{environment}})", {
                    environment: configured?.environment,
                  })
                : t("settings.channels.status.notConnected", "Not connected")}
            </Badge>
            {suggested && (
              <Badge variant="outline" data-cy={`channel-${providerId}-suggested`}>
                {t("settings.channels.status.suggested", "Suggested for your country")}
              </Badge>
            )}
            {/* Root TODO item 11 — a STRONGER, visually distinct badge for a channel the country
                MANDATES, never replacing the "suggested" badge above (a mandate is a strengthened
                suggestion, not a contradiction of it — see this file's own header on `requirement`).
                Shown unconditionally whenever the file declares `mandated`, regardless of whether
                `mandatedFrom` has actually been reached yet — the date itself is spelled out in the
                badge text so nothing here depends on today's wall-clock date to be TRUTHFUL. */}
            {suggested?.requirement === "mandated" && (
              <Badge variant="destructive" data-cy={`channel-${providerId}-mandated`}>
                {t("settings.channels.status.mandated", "Mandatory from {{date}}", {
                  date: suggested.mandatedFrom,
                })}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isConnected && !editing && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditing(true)}
                data-cy={`channel-${providerId}-edit-button`}
              >
                {t("settings.channels.actions.edit", "Edit")}
              </Button>
            )}
            {isConnected && (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={handleDisconnect}
                disabled={disconnecting}
                data-cy={`channel-${providerId}-disconnect-button`}
              >
                {disconnecting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  t("settings.channels.actions.disconnect", "Disconnect")
                )}
              </Button>
            )}
          </div>
        </div>
        {suggested && (
          <CardDescription>
            {suggested.provenance.kind === "unverified"
              ? suggested.provenance.resolutionNote
              : suggested.provenance.sourceText}
          </CardDescription>
        )}
      </CardHeader>
      {editing && (
        <CardContent className="space-y-4">
          {fields.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("settings.channels.messages.noFields", "This channel has no configurable fields yet.")}
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`${providerId}-environment`}>
                  {t("settings.channels.fields.environment", "Environment")}
                </Label>
                <Select value={environment} onValueChange={(v) => setEnvironment(v as ChannelEnvironment)}>
                  <SelectTrigger
                    id={`${providerId}-environment`}
                    className="w-full"
                    data-cy={`channel-${providerId}-environment-select`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent data-cy={`channel-${providerId}-environment-options`}>
                    <SelectItem value="TEST" data-cy={`channel-${providerId}-environment-option-test`}>
                      {t("settings.channels.fields.environmentTest", "Test (sandbox)")}
                    </SelectItem>
                    <SelectItem value="PROD" data-cy={`channel-${providerId}-environment-option-prod`}>
                      {t("settings.channels.fields.environmentProd", "Production")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {fields.map((field) => (
                <div className="space-y-1.5" key={field.key}>
                  <Label htmlFor={`${providerId}-${field.key}`}>
                    {t(field.labelKey, field.labelDefault)}
                  </Label>
                  <Input
                    id={`${providerId}-${field.key}`}
                    data-cy={`channel-${providerId}-${field.key.toLowerCase()}-input`}
                    type={field.type}
                    placeholder={field.placeholder}
                    value={config[field.key] ?? ""}
                    onChange={(e) => setConfig((prev) => ({ ...prev, [field.key]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
          )}
          <div className="flex justify-end gap-2">
            {isConnected && (
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                {t("settings.channels.actions.cancel", "Cancel")}
              </Button>
            )}
            <Button
              size="sm"
              onClick={handleConnect}
              disabled={connecting || fields.length === 0}
              data-cy={`channel-${providerId}-connect-button`}
            >
              {connecting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                t("settings.channels.actions.connect", "Connect")
              )}
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  )
}

/**
 * Company settings → Channels (`/settings/channels`, root TODO item 10) — connect/disconnect a
 * national transmission channel. `GET /api/company/channels` returns both what is already
 * `configured` (status only, never a secret — see `channels.service.ts`'s own header) and what this
 * company's OWN country `suggested` (advisory, item 10's "le pays suggère son canal" — the data comes
 * from `transports/channel-suggestion/data/*.json`, never a hard-coded country check here — a PL
 * company sees KSeF suggested, an IT company sees SdI, a FR company sees PDP, all from the same three
 * lines of JSON, item 10 wave 2).
 *
 * The provider list itself is the union of every registered TRANSPORT (`GET /api/documents/
 * transports`, excluding "email" — a plain address, not a channel needing credentials) with whatever
 * is already configured or suggested: a provider a company already connected keeps showing even if
 * it were ever deregistered, and a suggested-but-not-yet-registered provider (unreachable today)
 * would still be visible rather than silently dropped.
 *
 * Once connected, the provider becomes a normal option in the EXISTING invoice-transport picker
 * (`company.settings.tsx`'s own `invoiceTransportId` select, "company-invoice-transport-select") —
 * nothing here writes to that column: a company picks its transport there exactly as it always did,
 * this screen only ever decides whether that transport can actually deliver anything.
 */
export default function ChannelsSettings() {
  const { t } = useTranslation()
  const { data: channels, mutate } = useGet<ChannelsResponse>("/api/company/channels")
  const { data: transports } = useDocumentTransports()

  const knownProviderIds = (transports ?? []).map((tr) => tr.id).filter((id) => id !== "email")
  const configuredMap = new Map((channels?.configured ?? []).map((c) => [c.providerId, c] as const))
  const suggestedMap = new Map((channels?.suggested ?? []).map((s) => [s.providerId, s] as const))
  const providerIds = Array.from(
    new Set([...knownProviderIds, ...configuredMap.keys(), ...suggestedMap.keys()]),
  )

  return (
    <div className="space-y-6" data-cy="channels-section">
      <div>
        <h1 className="text-2xl font-bold mb-2">{t("settings.channels.title", "Channels")}</h1>
        <p className="text-muted-foreground">
          {t(
            "settings.channels.description",
            "Connect a national transmission channel — once connected, choose it below as this company's invoice transport.",
          )}
        </p>
      </div>

      <div className="space-y-4">
        {providerIds.map((id) => (
          <ChannelRow
            key={id}
            providerId={id}
            configured={configuredMap.get(id)}
            suggested={suggestedMap.get(id)}
            onChanged={mutate}
          />
        ))}

        {providerIds.length === 0 && (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-8">
              <Radio className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground text-center">
                {t("settings.channels.emptyState", "No national channel available yet")}
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
