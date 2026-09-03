"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useGet, usePost, usePut } from "@/hooks/use-fetch"

import { Button } from "@/components/ui/button"
import { DynamicFormModal } from "@/components/form-modal"
import type { FormConfig } from "@/components/form-modal"
import { ExternalLink } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { WebhookInstructionsModal } from "@/components/webhook-instructions-modal"
import { toast } from "sonner"
import { useState } from "react"
import { useTranslation } from "react-i18next"

interface InAppPlugin {
  id: string
  name: string
  isActive: boolean
  hasWebhook?: boolean
}

interface InAppPluginCategories {
  category: string
  plugins: InAppPlugin[]
}

// TODO_SUITE.md P2 (2026-09-03) — the external, git-clone plugin mechanism (POST /api/plugins,
// the "Add Plugin" git URL form, the installed-plugins list with delete) was removed: it had no
// real extension point behind it (see TODO_ISSUES.md, "Le système de plugins, vu par son premier
// vrai consommateur", T5c). Extensibility is now the narrow-interface-at-the-core pattern
// (ReceivedDocumentExtractor + registry, T5c's OCR/Mistral plugin) — not third-party code loading.
// Only the in-app plugins screen (PluginRegistry/PluginType, toggle + configure + webhook
// instructions) remains, and it is everything below.
export default function PluginsSettings() {
  const { t } = useTranslation()

  const [configModalOpen, setConfigModalOpen] = useState(false)
  const [configFormData, setConfigFormData] = useState<{
    pluginId: string
    formConfig: FormConfig
    currentConfig: any
  } | null>(null)
  const [togglingPluginId, setTogglingPluginId] = useState<string | null>(null)
  const [webhookInstructionsOpen, setWebhookInstructionsOpen] = useState(false)
  const [webhookInstructions, setWebhookInstructions] = useState<{
    pluginName: string
    webhookUrl: string
    webhookSecret: string
    instructions: string[]
  } | null>(null)

  const { data: inAppPlugins, mutate: mutateInAppPlugins } =
    useGet<InAppPluginCategories[]>("/api/plugins/in-app")

  const { trigger: togglePlugin } = usePut(`/api/plugins/in-app/toggle`)
  const { trigger: configurePlugin } = usePost(`/api/plugins/in-app/configure`)
  const { trigger: validatePlugin } = usePost(`/api/plugins/in-app/validate`)

  const pluginCount = inAppPlugins?.reduce((total, category) => total + category.plugins.length, 0) || 0

  const handleToggleInAppPlugin = async (pluginId: string) => {
    try {
      setTogglingPluginId(pluginId)
      const response = await togglePlugin({ pluginId })

      if (!response) throw new Error("Failed to toggle plugin")

      if (response.success === true) {
        toast.success(t("settings.plugins.messages.toggleSuccess"))
        mutateInAppPlugins()

        if (response.webhookUrl && response.instructions) {
          const plugin = inAppPlugins?.flatMap((cat) => cat.plugins).find((p) => p.id === pluginId)
          setWebhookInstructions({
            pluginName: plugin?.name || "Plugin",
            webhookUrl: response.webhookUrl,
            webhookSecret: response.webhookSecret,
            instructions: response.instructions,
          })
          setWebhookInstructionsOpen(true)
        }
      } else if (response.requiresConfiguration) {
        setConfigFormData({
          pluginId,
          formConfig: response.formConfig,
          currentConfig: response.currentConfig || {},
        })
        setConfigModalOpen(true)
      }
    } catch (error: any) {
      toast.error(error?.message || t("settings.plugins.messages.toggleError"))
    } finally {
      setTogglingPluginId(null)
    }
  }

  const handleConfigurePlugin = async (config: Record<string, any>) => {
    if (!configFormData) return

    try {
      const response = await configurePlugin({ pluginId: configFormData.pluginId, config })

      if (!response) throw new Error("Failed to configure plugin")

      if (response.success === true) {
        toast.success(t("settings.plugins.messages.configureSuccess"))
        setConfigModalOpen(false)
        setConfigFormData(null)
        mutateInAppPlugins()

        if (response.webhookUrl && response.instructions) {
          const plugin = inAppPlugins
            ?.flatMap((cat) => cat.plugins)
            .find((p) => p.id === configFormData.pluginId)
          setWebhookInstructions({
            pluginName: plugin?.name || "Plugin",
            webhookUrl: response.webhookUrl,
            webhookSecret: response.webhookSecret,
            instructions: response.instructions,
          })
          setWebhookInstructionsOpen(true)
        }
      }
    } catch (error: any) {
      toast.error(error?.message || t("settings.plugins.messages.configureError"))
    }
  }

  const handlePluginInstructions = async (pluginId: string) => {
    try {
      const response = await validatePlugin({ pluginId })

      if (!response) throw new Error("Failed to validate plugin")

      if (response.success === true) {
        mutateInAppPlugins()

        if (response.webhookUrl && response.webhookSecret && response.instructions) {
          const plugin = inAppPlugins?.flatMap((cat) => cat.plugins).find((p) => p.id === pluginId)
          setWebhookInstructions({
            pluginName: plugin?.name || "Plugin",
            webhookUrl: response.webhookUrl,
            webhookSecret: response.webhookSecret,
            instructions: response.instructions,
          })
          setWebhookInstructionsOpen(true)
        }
      }
    } catch (error: any) {
      toast.error(error?.message)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-2">{t("settings.plugins.title", { count: pluginCount })}</h1>
        <p className="text-muted-foreground">{t("settings.plugins.description")}</p>
      </div>

      {inAppPlugins && inAppPlugins.length > 0 && (
        <div className="space-y-4">
          {inAppPlugins.map((category) => (
            <Card key={category.category}>
              <CardHeader>
                <CardTitle className="capitalize">{category.category}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {category.plugins.map((plugin) => (
                    <div key={plugin.id} className="flex items-center justify-between p-3 border rounded-lg">
                      <div>
                        <p className="font-medium">{plugin.name}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {plugin.isActive && plugin.hasWebhook && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handlePluginInstructions(plugin.id)}
                            className="flex items-center gap-2"
                          >
                            <ExternalLink className="h-4 w-4" />
                            Webhook
                          </Button>
                        )}
                        <Switch
                          checked={plugin.isActive}
                          onCheckedChange={() => handleToggleInAppPlugin(plugin.id)}
                          disabled={togglingPluginId === plugin.id}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <DynamicFormModal
        open={configModalOpen}
        title="Configure Plugin"
        description="Please fill in the required configuration fields"
        config={configFormData?.formConfig || null}
        currentValues={configFormData?.currentConfig}
        onCancel={() => {
          setConfigModalOpen(false)
          setConfigFormData(null)
        }}
        onSubmit={(formData) => handleConfigurePlugin(formData)}
      />

      <WebhookInstructionsModal
        open={webhookInstructionsOpen}
        onOpenChange={setWebhookInstructionsOpen}
        pluginName={webhookInstructions?.pluginName || ""}
        webhookUrl={webhookInstructions?.webhookUrl || ""}
        webhookSecret={webhookInstructions?.webhookSecret || ""}
        instructions={webhookInstructions?.instructions || []}
      />
    </div>
  )
}
