"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { DynamicFormModal } from "@/components/form-modal"
import type { FormConfig } from "@/components/form-modal"
import { useGet, usePut } from "@/hooks/use-fetch"
import { useCompany } from "@/hooks/queries/use-company"
import { Loader2, Radio, Settings2 } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { useTranslation } from "react-i18next"

interface ProviderDef {
  id: string
  channel: string
  feedback: string
  configSchema: { fields: any[] } | null
}

interface ChannelConfig {
  providerId: string
  channel: string
  environment: string
  isActive: boolean
  config: Record<string, unknown>
}

export default function ChannelsSettings() {
  const { t } = useTranslation()
  const { data: company } = useCompany()
  const companyId = company?.id

  const { data: providers, loading: providersLoading } = useGet<ProviderDef[]>(
    companyId ? "/api/compliance/channels" : null,
  )
  const { data: configs, loading: configsLoading, mutate: refetchConfigs } = useGet<ChannelConfig[]>(
    companyId ? `/api/compliance/channels/companies/${companyId}` : null,
  )

  const { trigger: upsertConfig, loading: upsertLoading } = usePut(
    companyId ? `/api/compliance/channels/companies/${companyId}` : "",
  )

  const [configModalOpen, setConfigModalOpen] = useState(false)
  const [editingProvider, setEditingProvider] = useState<ProviderDef | null>(null)

  const configMap = new Map<string, ChannelConfig>()
  configs?.forEach((c) => configMap.set(`${c.providerId}:${c.environment}`, c))

  const handleConfigure = (provider: ProviderDef) => {
    setEditingProvider(provider)
    setConfigModalOpen(true)
  }

  const handleSubmitConfig = async (formData: Record<string, any>) => {
    if (!editingProvider || !companyId) return
    try {
      const environment = formData.environment ?? "TEST"
      const { environment: _, ...configData } = formData
      const response = await upsertConfig({
        providerId: editingProvider.id,
        environment,
        config: configData,
        isActive: true,
      })
      if (response) {
        toast.success(t("settings.channels.messages.saveSuccess", `${editingProvider.id} configured`))
        setConfigModalOpen(false)
        setEditingProvider(null)
        refetchConfigs()
      }
    } catch {
      toast.error(t("settings.channels.messages.saveError", "Failed to save configuration"))
    }
  }

  const buildFormConfig = (provider: ProviderDef): FormConfig | null => {
    if (!provider.configSchema) return null
    return {
      form: {
        fields: provider.configSchema.fields.map((f: any) => ({
          ...f,
          secret: undefined, // frontend doesn't need to know about secret flag — masked by API
        })),
      },
    }
  }

  const getConfiguredCount = () => configs?.length ?? 0

  if (providersLoading || configsLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-2">{t("settings.channels.title", "E-invoicing Channels")}</h1>
        <p className="text-muted-foreground">
          {t("settings.channels.description", "Configure credentials for each transmission provider. Secrets are encrypted at rest.")}
        </p>
      </div>

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Radio className="h-4 w-4" />
        <span>{getConfiguredCount()} configured</span>
      </div>

      <div className="space-y-4">
        {providers?.map((provider) => {
          const configured = configs?.find((c) => c.providerId === provider.id && c.environment === "TEST")
          const hasSchema = !!provider.configSchema

          return (
            <Card key={provider.id}>
              <CardContent className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{provider.id}</p>
                      <Badge variant={configured?.isActive ? "default" : "secondary"}>
                        {configured?.isActive ? "Active" : "Not configured"}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {provider.channel} &middot; {provider.feedback}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {hasSchema && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleConfigure(provider)}
                      disabled={upsertLoading}
                    >
                      <Settings2 className="h-4 w-4 mr-1" />
                      {configured ? "Edit" : "Configure"}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          )
        })}

        {providers?.length === 0 && (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-8">
              <Radio className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground text-center">
                {t("settings.channels.emptyState", "No transmission providers available")}
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {editingProvider && (
        <DynamicFormModal
          open={configModalOpen}
          title={`Configure ${editingProvider.id}`}
          description={`Set credentials and configuration for ${editingProvider.id}`}
          config={buildFormConfig(editingProvider)}
          currentValues={
            configs?.find((c) => c.providerId === editingProvider.id && c.environment === "TEST")?.config
          }
          onCancel={() => {
            setConfigModalOpen(false)
            setEditingProvider(null)
          }}
          onSubmit={handleSubmitConfig}
        />
      )}
    </div>
  )
}
