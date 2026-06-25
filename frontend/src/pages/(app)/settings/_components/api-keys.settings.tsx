"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { authenticatedFetch, useGet, usePost } from "@/hooks/use-fetch"

import { Button, buttonVariants } from "@/components/ui/button"
import { ExternalLink } from "lucide-react"
import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { useForm } from "react-hook-form"
import { useState } from "react"
import { useTranslation } from "react-i18next"

interface ApiKey {
    id: string
    name: string
    keyPrefix: string
    createdAt: string
    lastUsedAt: string | null
}

export default function ApiKeysSettings() {
    const { t } = useTranslation()
    const { data: apiKeys, mutate } = useGet<ApiKey[]>('/api/api-keys')
    const { trigger: createApiKey, loading: creating } = usePost('/api/api-keys')

    const [createdKey, setCreatedKey] = useState<string | null>(null)

    const form = useForm<{ name: string }>({
        defaultValues: { name: '' }
    })

    const handleCreate = form.handleSubmit(async (values) => {
        if (!values.name?.trim()) return
        try {
            const res = await createApiKey(values) as any
            if (res?.key) {
                setCreatedKey(res.key)
                form.reset({ name: '' })
                mutate()
            }
        } catch (e) {
            console.error('Error creating API key:', e)
        }
    })

    const handleDelete = async (id: string) => {
        try {
            const backendUrl = import.meta.env.VITE_BACKEND_URL || ''
            const res = await authenticatedFetch(`${backendUrl}/api/api-keys/${id}`, { method: 'DELETE' })
            if (!res.ok) return
            mutate()
        } catch { }
    }

    return (
        <div className="h-full">
            <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold">{t("settings.apiKeys.title")}</h1>
                    <p className="text-muted-foreground">{t("settings.apiKeys.description")}</p>
                </div>
                <a
                    href={`${import.meta.env.VITE_BACKEND_URL || ""}/api/docs`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                >
                    <ExternalLink className="h-4 w-4 mr-2" />
                    {t("settings.apiKeys.swaggerLink")}
                </a>
            </div>

            {createdKey && (
                <Card className="mb-4">
                    <CardContent>
                        <CardTitle>{t('settings.apiKeys.createdKeyTitle')}</CardTitle>
                        <CardDescription>
                            <div className="break-all font-mono bg-muted p-2 rounded">{createdKey}</div>
                            <div className="text-sm text-muted-foreground mt-2">{t('settings.apiKeys.createdKeyNotice')}</div>
                        </CardDescription>
                    </CardContent>
                </Card>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-4 pr-2 overflow-hidden">
                    {apiKeys?.map((key) => (
                        <Card key={key.id} className="w-full">
                            <CardHeader className="w-full">
                                <CardTitle className="text-sm flex items-center gap-2">
                                    <span className="font-medium">{key.name}</span>
                                    <span className="font-mono text-xs text-muted-foreground">{key.keyPrefix}…</span>
                                </CardTitle>
                                <CardDescription>
                                    {key.lastUsedAt
                                        ? t('settings.apiKeys.card.lastUsed', { date: new Date(key.lastUsedAt).toLocaleString() })
                                        : t('settings.apiKeys.card.neverUsed')}
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <Button variant="destructive" size="sm" onClick={() => handleDelete(key.id)}>
                                    {t('settings.apiKeys.card.revoke')}
                                </Button>
                            </CardContent>
                        </Card>
                    ))}
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle>{t("settings.apiKeys.create.title")}</CardTitle>
                        <CardDescription>{t("settings.apiKeys.create.description")}</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Form {...form}>
                            <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); handleCreate(); }}>
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

                                <div className="flex justify-end">
                                    <Button type="submit" disabled={creating}>{t("settings.apiKeys.create.button")}</Button>
                                </div>
                            </form>
                        </Form>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
