"use client"

import { Trash2, Webhook as WebhookIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { MultiSelect } from "@/components/ui/multi-select"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { authenticatedFetch, useGet, usePost } from "@/hooks/use-fetch"
import { useMutationWithToast } from "@/hooks/use-mutation-with-toast"

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

interface Webhook {
  id: string
  url: string
  secret?: string
  type: string
  events: string[]
}

export default function WebhooksSettings() {
  const { t } = useTranslation()
  const { data: webhooks, mutate } = useGet<Webhook[]>("/api/webhooks")
  const { trigger: createWebhook, loading: creating } = useMutationWithToast(
    usePost("/api/webhooks"),
    t("settings.webhooks.messages.createError", "Failed to create webhook"),
  )
  const { data: options } = useGet<{ types: string[]; events: string[] }>("/api/webhooks/options")
  const [saved, flash] = useSavedFlash()

  const [createdSecret, setCreatedSecret] = useState<string | null>(null)
  const [multiResetKey, setMultiResetKey] = useState(0)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)

  // options.events will be populated from the backend

  useEffect(() => {
    if (options?.types && options.types.length) {
      form.reset({ ...form.getValues(), type: options.types[0] })
    }
  }, [options])

  const form = useForm<{ url: string; type: string; events: string[] }>({
    defaultValues: { url: "", type: options?.types?.[0] ?? "GENERIC", events: [] },
  })

  const handleCreate = form.handleSubmit(async (values) => {
    if (!values.url?.trim()) return
    const res = await createWebhook(values)
    if (!res) return // error already toasted by the wrapper
    if ((res as any).success) {
      const secret = (res as any).data?.secret
      if (secret) setCreatedSecret(secret)
      form.reset({ url: "", type: options?.types?.[0] ?? "GENERIC", events: [] })
      // force remount of MultiSelect so it picks up cleared value
      setMultiResetKey((k) => k + 1)
      flash()
      mutate()
    } else {
      toast.error(t("settings.webhooks.messages.createError", "Failed to create webhook"))
    }
  })

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    try {
      const backendUrl = import.meta.env.VITE_BACKEND_URL || ""
      const res = await authenticatedFetch(`${backendUrl}/api/webhooks/${id}`, { method: "DELETE" })
      const json = res.ok ? await res.json() : null
      if (json && json.success) {
        mutate()
      } else {
        toast.error(t("settings.webhooks.messages.deleteError", "Failed to delete webhook"))
      }
    } catch {
      toast.error(t("settings.webhooks.messages.deleteError", "Failed to delete webhook"))
    } finally {
      setDeletingId(null)
    }
  }

  const handleEdit = async (id: string, currentUrl: string) => {
    const newUrl = window.prompt(t("settings.webhooks.card.editPrompt") || "New webhook URL", currentUrl)
    if (!newUrl) return
    setEditingId(id)
    try {
      const backendUrl = import.meta.env.VITE_BACKEND_URL || ""
      const res = await authenticatedFetch(`${backendUrl}/api/webhooks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: newUrl }),
      })
      const json = res.ok ? await res.json() : null
      if (json && json.success) {
        mutate()
      } else {
        toast.error(t("settings.webhooks.messages.updateError", "Failed to update webhook"))
      }
    } catch {
      toast.error(t("settings.webhooks.messages.updateError", "Failed to update webhook"))
    } finally {
      setEditingId(null)
    }
  }

  return (
    <SettingsPage title={t("settings.webhooks.title")} description={t("settings.webhooks.description")}>
      {createdSecret && (
        <SettingsSection
          tone="warning"
          title={t("settings.webhooks.createdSecretTitle")}
          dataCy="webhook-created-secret"
        >
          <div className="grid gap-2">
            <div className="break-all rounded-md bg-muted p-2 font-mono text-sm">{createdSecret}</div>
            <p className="text-xs text-muted-foreground">{t("settings.webhooks.createdSecretNotice")}</p>
          </div>
        </SettingsSection>
      )}

      <SettingsSection
        title={t("settings.webhooks.list.title")}
        aside={webhooks && webhooks.length > 0 && <Badge variant="secondary">{webhooks.length}</Badge>}
        dataCy="webhooks-list-section"
      >
        {!webhooks ? (
          <SettingsListSkeleton rows={2} />
        ) : webhooks.length === 0 ? (
          <EmptyState
            icon={WebhookIcon}
            size="sm"
            title={t("settings.webhooks.list.empty")}
            data-cy="webhooks-empty"
          />
        ) : (
          <SettingsList>
            {webhooks.map((wh) => (
              <SettingsListRow
                key={wh.id}
                dataCy={`webhook-row-${wh.id}`}
                badge={<Badge variant="secondary">{wh.type}</Badge>}
                title={<span className="min-w-0 break-all font-mono text-sm">{wh.url}</span>}
                meta={
                  // One line per event rather than a comma-joined string: a webhook subscribed to a
                  // dozen events used to render as a single row the browser then truncated, so the
                  // tail of the list was simply unreadable.
                  <>
                    <span>{t("settings.webhooks.card.events")}</span>
                    <ul className="mt-1 list-inside list-disc space-y-0.5">
                      {wh.events.map((event) => (
                        <li key={event} className="break-all">
                          {event}
                        </li>
                      ))}
                    </ul>
                  </>
                }
                primary={
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleEdit(wh.id, wh.url)}
                    loading={editingId === wh.id}
                  >
                    {t("settings.webhooks.card.edit")}
                  </Button>
                }
                menu={
                  <SettingsRowMenu
                    dataCy={`webhook-menu-${wh.id}`}
                    items={[
                      {
                        label: t("settings.webhooks.card.delete"),
                        icon: Trash2,
                        destructive: true,
                        disabled: deletingId === wh.id,
                        dataCy: `webhook-delete-${wh.id}`,
                        onSelect: () => handleDelete(wh.id),
                      },
                    ]}
                  />
                }
              />
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
            title={t("settings.webhooks.create.title")}
            description={t("settings.webhooks.create.description")}
            dataCy="webhook-create-section"
            contentClassName="grid gap-4 sm:grid-cols-2"
            footer={
              <SettingsFormFooter saved={saved}>
                <Button type="submit" loading={creating} dataCy="webhook-create-submit">
                  {t("settings.webhooks.create.button")}
                </Button>
              </SettingsFormFooter>
            }
          >
            <FormField
              name="url"
              control={form.control}
              render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>{t("settings.webhooks.create.url")}</FormLabel>
                  <FormControl>
                    <Input data-cy="webhook-url-input" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              name="type"
              control={form.control}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("settings.webhooks.create.type")}</FormLabel>
                  <FormControl>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(options?.types || []).map((type) => (
                          <SelectItem key={type} value={type}>
                            {type}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              name="events"
              control={form.control}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("settings.webhooks.create.events")}</FormLabel>
                  <FormControl>
                    <MultiSelect
                      data-cy="webhook-events-select"
                      key={multiResetKey}
                      defaultValue={field.value || []}
                      options={(options?.events || []).map((event) => ({ label: event, value: event }))}
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
