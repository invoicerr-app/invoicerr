"use client"

import { Copy, ExternalLink, KeyRound, Trash2 } from "lucide-react"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { MultiSelect } from "@/components/ui/multi-select"
import { authenticatedFetch, useGet, usePost } from "@/hooks/use-fetch"
import { cn } from "@/lib/utils"

import {
  SettingsFormFooter,
  SettingsList,
  SettingsListRow,
  SettingsListSkeleton,
  SettingsPage,
  SettingsRowMenu,
  SettingsSection,
  useSavedFlash,
} from "./settings-section"

interface ApiKey {
  id: string
  name: string
  keyPrefix: string
  scopes: string[]
  createdAt: string
  lastUsedAt: string | null
}

export default function ApiKeysSettings() {
  const { t } = useTranslation()
  const { data: apiKeys, mutate } = useGet<ApiKey[]>("/api/api-keys")
  const { trigger: createApiKey, loading: creating } = usePost("/api/api-keys")
  const { data: options } = useGet<{ scopes: string[] }>("/api/api-keys/options")
  const [saved, flash] = useSavedFlash()

  const [createdKey, setCreatedKey] = useState<string | null>(null)
  const [multiResetKey, setMultiResetKey] = useState(0)

  const form = useForm<{ name: string; scopes: string[] }>({
    defaultValues: { name: "", scopes: [] },
  })

  const handleCreate = form.handleSubmit(async (values) => {
    if (!values.name?.trim()) return
    try {
      const res = (await createApiKey(values)) as any
      if (res?.key) {
        setCreatedKey(res.key)
        form.reset({ name: "", scopes: [] })
        // force remount of MultiSelect so it picks up cleared value
        setMultiResetKey((k) => k + 1)
        flash()
        mutate()
      }
    } catch (e) {
      console.error("Error creating API key:", e)
    }
  })

  const handleDelete = async (id: string) => {
    try {
      const backendUrl = import.meta.env.VITE_BACKEND_URL || ""
      const res = await authenticatedFetch(`${backendUrl}/api/api-keys/${id}`, { method: "DELETE" })
      if (!res.ok) return
      mutate()
    } catch {}
  }

  const handleCopy = () => {
    if (createdKey) void navigator.clipboard.writeText(createdKey)
  }

  return (
    <SettingsPage
      title={t("settings.apiKeys.title")}
      description={t("settings.apiKeys.description")}
      actions={
        <a
          href={`${import.meta.env.VITE_BACKEND_URL || ""}/api/docs`}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        >
          <ExternalLink />
          {t("settings.apiKeys.swaggerLink")}
        </a>
      }
    >
      {createdKey && (
        <SettingsSection
          tone="warning"
          title={t("settings.apiKeys.createdKeyTitle")}
          dataCy="api-key-created"
        >
          <div className="grid gap-2">
            <div className="flex items-center gap-2 rounded-md bg-muted p-2">
              <code className="min-w-0 flex-1 break-all font-mono text-sm">{createdKey}</code>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("settings.common.copy")}
                tooltip={t("settings.common.copy")}
                onClick={handleCopy}
              >
                <Copy />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t("settings.apiKeys.createdKeyNotice")}</p>
          </div>
        </SettingsSection>
      )}

      <SettingsSection
        title={t("settings.apiKeys.list.title")}
        aside={apiKeys && apiKeys.length > 0 && <Badge variant="secondary">{apiKeys.length}</Badge>}
        dataCy="api-keys-list-section"
      >
        {!apiKeys ? (
          <SettingsListSkeleton rows={2} />
        ) : apiKeys.length === 0 ? (
          <EmptyState
            icon={KeyRound}
            size="sm"
            title={t("settings.apiKeys.list.empty")}
            data-cy="api-keys-empty"
          />
        ) : (
          <SettingsList>
            {apiKeys.map((key) => (
              <SettingsListRow
                key={key.id}
                dataCy={`api-key-row-${key.id}`}
                title={key.name}
                meta={
                  <span className="font-mono tabular-nums">
                    {key.keyPrefix}… ·{" "}
                    {key.lastUsedAt
                      ? t("settings.apiKeys.card.lastUsed", {
                          date: new Date(key.lastUsedAt).toLocaleString(),
                        })
                      : t("settings.apiKeys.card.neverUsed")}
                  </span>
                }
                menu={
                  <SettingsRowMenu
                    dataCy={`api-key-menu-${key.id}`}
                    items={[
                      {
                        label: t("settings.apiKeys.card.revoke"),
                        icon: Trash2,
                        destructive: true,
                        dataCy: `api-key-revoke-${key.id}`,
                        onSelect: () => handleDelete(key.id),
                      },
                    ]}
                  />
                }
              >
                {key.scopes.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {key.scopes.map((scope) => (
                      <Badge key={scope} variant="outline" className="font-mono text-[10px]">
                        {scope}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground italic">
                    {t("settings.apiKeys.card.noScopes")}
                  </span>
                )}
              </SettingsListRow>
            ))}
          </SettingsList>
        )}
      </SettingsSection>

      <Form {...form}>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            handleCreate()
          }}
        >
          <SettingsSection
            title={t("settings.apiKeys.create.title")}
            description={t("settings.apiKeys.create.description")}
            dataCy="api-key-create-section"
            contentClassName="grid gap-4 sm:grid-cols-2"
            footer={
              <SettingsFormFooter saved={saved}>
                <Button type="submit" loading={creating}>
                  {t("settings.apiKeys.create.button")}
                </Button>
              </SettingsFormFooter>
            }
          >
            <FormField
              name="name"
              control={form.control}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("settings.apiKeys.create.name")}</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder={t("settings.apiKeys.create.namePlaceholder")} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              name="scopes"
              control={form.control}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("settings.apiKeys.create.scopes")}</FormLabel>
                  <FormControl>
                    <MultiSelect
                      key={multiResetKey}
                      defaultValue={field.value || []}
                      options={(options?.scopes || []).map((scope) => ({ label: scope, value: scope }))}
                      onValueChange={field.onChange}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </SettingsSection>
        </form>
      </Form>
    </SettingsPage>
  )
}
