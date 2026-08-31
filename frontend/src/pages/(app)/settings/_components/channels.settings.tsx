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
  provenance: ChannelProvenance
}
interface ChannelsResponse {
  configured: ConfiguredChannel[]
  suggested: SuggestedChannel[]
}

/** Friendly display names for known providers — `TransportRegistry.list()`'s own label ("PDP
 *  (France)") is written for the invoice-transport PICKER, not this settings screen; falls back to
 *  the bare id (uppercased) for a provider this screen has no opinion about yet. */
const PROVIDER_LABELS: Record<string, string> = { pdp: "PDP" }

/**
 * One channel's connect/disconnect card — item 10 (root TODO), wave 1. `GET/PUT/DELETE
 * /api/company/channels/:providerId` (`modules/company/channels/`): the PUT body is encrypted at
 * rest server-side and NEVER echoed back — see `channels.service.ts`'s own header — so this
 * component never has a decrypted secret to pre-fill an edit form with; "Edit" always starts blank.
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
  const [baseUrl, setBaseUrl] = useState("")
  const [clientId, setClientId] = useState("")
  const [clientSecret, setClientSecret] = useState("")
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
    if (!baseUrl.trim() || !clientId.trim() || !clientSecret.trim()) {
      toast.error(
        t(
          "settings.channels.messages.fieldsRequired",
          "Base URL, client ID and client secret are all required",
        ),
      )
      return
    }
    const result = await upsert({ environment, config: { baseUrl, clientId, clientSecret } })
    if (!result) return // error already toasted by the wrapper
    toast.success(t("settings.channels.messages.connectSuccess", "Channel connected"))
    setClientSecret("")
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
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`${providerId}-baseurl`}>
                {t("settings.channels.fields.baseUrl", "API base URL")}
              </Label>
              <Input
                id={`${providerId}-baseurl`}
                data-cy={`channel-${providerId}-baseurl-input`}
                placeholder="https://api.superpdp.tech"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
            </div>
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
            <div className="space-y-1.5">
              <Label htmlFor={`${providerId}-clientid`}>
                {t("settings.channels.fields.clientId", "Client ID")}
              </Label>
              <Input
                id={`${providerId}-clientid`}
                data-cy={`channel-${providerId}-clientid-input`}
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${providerId}-clientsecret`}>
                {t("settings.channels.fields.clientSecret", "Client secret")}
              </Label>
              <Input
                id={`${providerId}-clientsecret`}
                data-cy={`channel-${providerId}-clientsecret-input`}
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            {isConnected && (
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                {t("settings.channels.actions.cancel", "Cancel")}
              </Button>
            )}
            <Button
              size="sm"
              onClick={handleConnect}
              disabled={connecting}
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
 * from `transports/channel-suggestion/data/*.json`, never a hard-coded country check here).
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
