"use client"

import { Loader2 } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import type { CredentialFieldDescriptor } from "@/hooks/queries"
import { usePut } from "@/hooks/use-fetch"
import { useMutationWithToast } from "@/hooks/use-mutation-with-toast"

type ChannelEnvironment = "TEST" | "PROD"

/**
 * Issue #527 - the connect form, in a side sheet, generated ENTIRELY from `credentialFields`
 * (`GET /api/documents/transports`, issue #526's own `CredentialFieldDescriptor`) - never a second,
 * hand-maintained copy of what each transport's connect form collects. Replaces the old inline
 * per-`ChannelRow` form the pre-#527 `channels.settings.tsx` used to render, and the `PROVIDER_FIELDS`
 * map that used to back it (deleted).
 *
 * Mounted fresh (by `key`, from its own caller) every time it opens for a DIFFERENT providerId, and
 * its own local `config` state always starts at `{}` - "Edit" never pre-fills a value, because the
 * PUT/GET contract this whole module holds never echoes a stored secret back (see
 * `channels.service.ts`'s own "GET never leaks a secret" guarantee) - there is nothing this sheet
 * COULD pre-fill even for a text (non-secret) field, since the backend does not distinguish "give me
 * back what I stored" from "give me back a secret" at the wire level, only the UI masking differs.
 */
export function ChannelConnectSheet({
  open,
  onOpenChange,
  providerId,
  title,
  description,
  credentialFields,
  defaultEnvironment,
  onConnected,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  providerId: string
  title: string
  description?: string
  credentialFields: CredentialFieldDescriptor[]
  defaultEnvironment?: ChannelEnvironment
  onConnected: () => void
}) {
  const { t } = useTranslation()
  // `learnedByBackend` fields are read by the transport's own parser but populated by the BACKEND
  // itself after a first reply (e.g. sdi-pec's `sdiReplyAddress`) - never rendered as an input, see
  // `CredentialFieldDescriptor.learnedByBackend`'s own backend header.
  const renderableFields = credentialFields.filter((field) => !field.learnedByBackend)

  const [environment, setEnvironment] = useState<ChannelEnvironment>(defaultEnvironment ?? "TEST")
  const [config, setConfig] = useState<Record<string, string>>({})

  // Every open (a fresh providerId, or the SAME provider re-opened after a close) starts BLANK - the
  // sheet is remounted by `key` from its own caller for a providerId change, but the ENVIRONMENT
  // default still needs resetting when the same provider's sheet is closed and reopened. Deliberately
  // keyed on `open`/`credentialFields`/`defaultEnvironment` only (never the derived `renderableFields`,
  // a fresh array every render) - re-deriving it INSIDE the effect keeps this from re-running on every
  // parent re-render while `open` stays true.
  useEffect(() => {
    if (open) {
      const fields = credentialFields.filter((field) => !field.learnedByBackend)
      setConfig(Object.fromEntries(fields.map((f) => [f.key, ""])))
      setEnvironment(defaultEnvironment ?? "TEST")
    }
  }, [open, credentialFields, defaultEnvironment])

  const { trigger: upsert, loading: connecting } = useMutationWithToast(
    usePut(`/api/company/channels/${providerId}`),
    t("settings.channels.messages.connectError", "Failed to connect the channel"),
  )

  const handleSubmit = async () => {
    const missing = renderableFields.filter((f) => f.required && !config[f.key]?.trim())
    if (missing.length > 0) {
      toast.error(
        t("settings.channels.messages.fieldsRequired", "{{fields}} are all required", {
          fields: missing.map((f) => t(f.labelKey)).join(", "),
        }),
      )
      return
    }
    const result = await upsert({ environment, config })
    if (!result) return // error already toasted by the wrapper
    toast.success(t("settings.channels.messages.connectSuccess", "Channel connected"))
    onOpenChange(false)
    onConnected()
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent data-cy={`channel-connect-sheet-${providerId}`}>
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          {description && <SheetDescription>{description}</SheetDescription>}
        </SheetHeader>
        <div className="flex flex-col gap-4 overflow-y-auto px-4">
          {renderableFields.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("settings.channels.messages.noFields", "This channel has no configurable fields yet.")}
            </p>
          ) : (
            <>
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
              {renderableFields.map((field) => (
                <div className="space-y-1.5" key={field.key}>
                  <Label htmlFor={`${providerId}-${field.key}`}>
                    {t(field.labelKey)}
                    {!field.required && (
                      <span className="text-muted-foreground font-normal">
                        {" "}
                        {t("settings.channels.fields.optional", "(optional)")}
                      </span>
                    )}
                  </Label>
                  <Input
                    id={`${providerId}-${field.key}`}
                    data-cy={`channel-${providerId}-${field.key.toLowerCase()}-input`}
                    type={
                      field.kind === "secret" ? "password" : field.valueType === "number" ? "number" : "text"
                    }
                    placeholder={field.placeholder}
                    value={config[field.key] ?? ""}
                    onChange={(e) => setConfig((prev) => ({ ...prev, [field.key]: e.target.value }))}
                  />
                </div>
              ))}
            </>
          )}
        </div>
        <SheetFooter>
          <Button
            onClick={handleSubmit}
            disabled={connecting || renderableFields.length === 0}
            data-cy={`channel-${providerId}-connect-button`}
          >
            {connecting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              t("settings.channels.actions.connect", "Connect")
            )}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
