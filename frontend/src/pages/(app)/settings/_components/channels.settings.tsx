"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { DynamicFormModal } from "@/components/form-modal"
import type { FormConfig } from "@/components/form-modal"
import { useGet, usePut, authenticatedFetch } from "@/hooks/use-fetch"
import { useCompany } from "@/hooks/queries/use-company"
import { CheckCircle2, ExternalLink, Loader2, Radio, Settings2, Trash2, XCircle } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { useTranslation } from "react-i18next"

interface ProviderMeta {
  id: string
  channel: string
  feedback: string
  configSchema: { fields: any[] } | null
}

interface RequiredChannel {
  type: string
  providerId: string
  provider: ProviderMeta | null
  isConfigured: boolean
  environment: string | null
  config: Record<string, unknown> | null
}

export default function ChannelsSettings() {
  const { t } = useTranslation()
  const { data: company } = useCompany()
  const companyId = company?.id

  const {
    data: requiredChannels,
    loading,
    mutate: refetch,
  } = useGet<RequiredChannel[]>(
    companyId ? `/api/compliance/channels/companies/${companyId}/required-channels` : null,
  )

  const { trigger: upsertConfig, loading: upsertLoading } = usePut(
    companyId ? `/api/compliance/channels/companies/${companyId}` : "",
  )

  const [configModalOpen, setConfigModalOpen] = useState(false)
  const [editingChannel, setEditingChannel] = useState<RequiredChannel | null>(null)

  const handleConfigure = (ch: RequiredChannel) => {
    setEditingChannel(ch)
    setConfigModalOpen(true)
  }

  const handleSubmitConfig = async (formData: Record<string, any>) => {
    if (!editingChannel || !companyId) return
    try {
      const environment = formData.environment ?? "TEST"
      const { environment: _, ...configData } = formData
      const response = await upsertConfig({
        providerId: editingChannel.providerId,
        environment,
        config: configData,
        isActive: true,
      })
      if (response) {
        toast.success(t("settings.channels.messages.saveSuccess", `${editingChannel.providerId} configured`))
        setConfigModalOpen(false)
        setEditingChannel(null)
        refetch()
      } else {
        // trigger() swallows HTTP errors and returns null — surface it instead of failing silently.
        toast.error(t("settings.channels.messages.saveError", "Failed to save configuration"))
      }
    } catch {
      toast.error(t("settings.channels.messages.saveError", "Failed to save configuration"))
    }
  }

  const handleDelete = async (ch: RequiredChannel) => {
    if (!companyId) return
    try {
      const res = await authenticatedFetch(
        `/api/compliance/channels/companies/${companyId}/${ch.providerId}`,
        {
          method: "DELETE",
          body: JSON.stringify({ environment: ch.environment ?? "TEST" }),
        },
      )
      if (!res.ok) throw new Error("Delete failed")
      toast.success(t("settings.channels.messages.deleteSuccess", `${ch.providerId} disconnected`))
      refetch()
    } catch {
      toast.error(t("settings.channels.messages.deleteError", "Failed to disconnect"))
    }
  }

  const buildFormConfig = (ch: RequiredChannel): FormConfig | null => {
    if (!ch.provider?.configSchema) return null
    return {
      form: {
        fields: ch.provider.configSchema.fields.map((f: any) => ({
          ...f,
          secret: undefined,
        })),
      },
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const DOCS_BASE = `${import.meta.env.DEV ? "http://localhost:3001" : "https://docs.invoicerr.app"}/docs/user-guide/e-invoicing`
  const DOC_SLUGS: Record<string, string> = {
    superpdp: "superpdp",
    pdp: "superpdp",
    ksef: "ksef",
    sdi: "sdi",
  }

  const countryCode = company?.countryCode
  const country = company?.country
  const countryFlag = countryCode
    ? String.fromCodePoint(...countryCode.toUpperCase().split("").map((c) => 0x1F1E6 + c.charCodeAt(0) - 0x41))
    : ""

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold mb-2">{t("settings.channels.title", "E-invoicing Channels")}</h1>
          <p className="text-muted-foreground">
            {t(
              "settings.channels.description",
              "Connect the transmission channels required by your company's country. Secrets are encrypted at rest.",
            )}
          </p>
        </div>
        {countryCode && (
          <Badge variant="outline" className="text-base px-3 py-1 shrink-0 mt-1">
            {countryFlag} {country}
          </Badge>
        )}
      </div>

      <div className="space-y-4">
        {requiredChannels?.map((ch) => {
          const hasSchema = !!ch.provider?.configSchema

          return (
            <Card key={ch.providerId}>
              <CardContent className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  <div className="shrink-0">
                    {ch.isConfigured ? (
                      <CheckCircle2 className="h-5 w-5 text-green-500" />
                    ) : (
                      <XCircle className="h-5 w-5 text-muted-foreground" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{ch.providerId}</p>
                      <Badge variant={ch.isConfigured ? "default" : "secondary"}>
                        {ch.isConfigured
                          ? t("settings.channels.status.connected", "Connected")
                          : t("settings.channels.status.notConfigured", "Not configured")}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {ch.type}
                      {ch.provider?.feedback ? ` · ${ch.provider.feedback}` : ""}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {DOC_SLUGS[ch.providerId] && (
                    <a
                      href={`${DOCS_BASE}/${DOC_SLUGS[ch.providerId]}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Button variant="ghost" size="sm">
                        <ExternalLink className="h-4 w-4 mr-1" />
                        {t("settings.channels.actions.documentation", "Documentation")}
                      </Button>
                    </a>
                  )}
                  {hasSchema && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleConfigure(ch)}
                      disabled={upsertLoading}
                    >
                      <Settings2 className="h-4 w-4 mr-1" />
                      {ch.isConfigured
                        ? t("settings.channels.actions.edit", "Edit")
                        : t("settings.channels.actions.connect", "Connect")}
                    </Button>
                  )}
                  {ch.isConfigured && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(ch)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          )
        })}

        {requiredChannels?.length === 0 && (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-8">
              <Radio className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground text-center">
                {t("settings.channels.emptyState", "No transmission channels required for your country")}
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {editingChannel && (
        <DynamicFormModal
          open={configModalOpen}
          title={`${t("settings.channels.configure", "Configure")} ${editingChannel.providerId}`}
          description={`${t("settings.channels.configureDesc", "Set credentials for")} ${editingChannel.providerId}`}
          config={buildFormConfig(editingChannel)}
          currentValues={{
            ...(editingChannel.config ?? {}),
            // `environment` lives in the DB column, not the config blob — merge it so the select pre-fills.
            ...(editingChannel.environment ? { environment: editingChannel.environment } : {}),
          }}
          onCancel={() => {
            setConfigModalOpen(false)
            setEditingChannel(null)
          }}
          onSubmit={handleSubmitConfig}
        />
      )}
    </div>
  )
}
