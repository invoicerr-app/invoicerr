"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { CheckCircle2, Mail } from "lucide-react"
import { useMemo, useState } from "react"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { z } from "zod"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { ApiError } from "@/hooks/use-api-query"
import {
  useClearCompanyMailSettings,
  useCompanyMailSettings,
  useSetCompanyMailSettings,
  useTestCompanyMailSettings,
} from "@/hooks/queries"
import type { SetCompanyMailSettingsInput } from "@/hooks/queries"
import { SettingsFormFooter, SettingsPage, SettingsSection } from "./settings-section"

/** Display label for a configured provider — the settings-screen equivalent of
 *  `channels.settings.tsx`'s own `PROVIDER_LABELS`. */
const PROVIDER_LABELS: Record<"smtp" | "resend", string> = {
  smtp: "SMTP",
  resend: "Resend",
}

interface MailSettingsFormValues {
  kind: "smtp" | "resend"
  host: string
  port?: number
  secure: boolean
  username: string
  password: string
  apiKey: string
  fromAddress: string
}

const EMPTY_FORM_VALUES: MailSettingsFormValues = {
  kind: "smtp",
  host: "",
  // Empty, never a pre-filled "587" — every OTHER numeric field in this codebase starts empty too
  // (`schema.ts#defaultValuesFor`), and this one is the sole exception, for no functional reason: a
  // pre-filled value is one a user (or a test's `.clear()`) can fail to fully remove before typing a
  // new one, silently concatenating into an out-of-range value the port field's own comment in
  // `buildSchema` covers. "587" survives only as the `placeholder` below — a hint, never a value that
  // has to be cleared first.
  port: undefined,
  secure: false,
  username: "",
  password: "",
  apiKey: "",
  fromAddress: "",
}

/**
 * `PUT /api/company/mail-settings` requires a different field set per `kind` (see
 * `company-mail-settings.service.ts#validate`, the exact server-side rule this `superRefine` echoes —
 * a same-origin, best-effort echo only: the server is still the real gate, the same discipline
 * `company.settings.tsx`'s own identifier-pattern echo already documents). A single flat schema
 * (rather than `z.discriminatedUnion`) because the FORM keeps every field mounted at once — only the
 * fields for the selected `kind` are ever rendered — so the values object always carries all of them.
 */
function buildSchema(t: (key: string, fallback: string) => string) {
  return z
    .object({
      kind: z.enum(["smtp", "resend"]),
      host: z.string(),
      // The native `<input type="number" min={1} max={65535}>` below carries the SAME bound — this
      // is not redundant. A browser's own constraint validation runs BEFORE any React code on a
      // real `<button type="submit">` click, and rejects an out-of-range value by silently
      // cancelling the "submit" event: no `onSubmit`, no zod error, no toast, no network request —
      // indistinguishable from a dead button. Confirmed live (2026-09-15): starting from the
      // pre-filled default (587) and typing "1025" WITHOUT first clearing the field concatenates to
      // "5871025", and clicking Save then fires literally zero requests. Zod alone can never be the
      // gate for a field that also carries a native constraint the browser enforces first — this
      // bound, plus `noValidate` on the `<form>` below (which disables the browser's silent gate
      // entirely), together guarantee THIS validation — the one that actually shows a message — is
      // what decides submission, on every browser.
      port: z
        .number()
        .int()
        .positive()
        .max(65535, t("settings.mail.form.validation.portOutOfRange", "Port must be 65535 or lower"))
        .optional(),
      secure: z.boolean(),
      username: z.string(),
      password: z.string(),
      apiKey: z.string(),
      fromAddress: z
        .string()
        .min(1, t("settings.mail.form.validation.fromAddressRequired", "From address is required")),
    })
    .superRefine((val, ctx) => {
      if (val.kind === "smtp") {
        if (!val.host.trim()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["host"],
            message: t("settings.mail.form.validation.hostRequired", "Host is required"),
          })
        }
        if (!val.port) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["port"],
            message: t("settings.mail.form.validation.portRequired", "Port is required"),
          })
        }
        if (!val.username.trim()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["username"],
            message: t("settings.mail.form.validation.usernameRequired", "Username is required"),
          })
        }
        if (!val.password.trim()) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["password"],
            message: t("settings.mail.form.validation.passwordRequired", "Password is required"),
          })
        }
      } else if (!val.apiKey.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["apiKey"],
          message: t("settings.mail.form.validation.apiKeyRequired", "API key is required"),
        })
      }
    })
}

/**
 * The connect/update form — same "always starts blank on Edit" discipline as
 * `channels.settings.tsx`'s `ChannelRow`: `GET /api/company/mail-settings` never carries a secret
 * (`CompanyMailSettingsStatus` has no field for one), so there is nothing to pre-fill a password/API
 * key with. `fromAddress` and `kind` ARE known (not secrets) and are pre-filled from the current
 * status when editing an existing configuration. One 2-column grid throughout: the provider select
 * governs which of the fields below it are relevant, but never needs a section of its own.
 */
function MailSettingsForm({
  currentKind,
  currentFromAddress,
  onSaved,
  onCancel,
  showCancel,
}: {
  currentKind?: "smtp" | "resend"
  currentFromAddress?: string
  onSaved: () => void
  onCancel: () => void
  showCancel: boolean
}) {
  const { t } = useTranslation()
  const setMailSettings = useSetCompanyMailSettings()

  const schema = useMemo(() => buildSchema(t), [t])
  const form = useForm<MailSettingsFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      ...EMPTY_FORM_VALUES,
      kind: currentKind ?? "smtp",
      fromAddress: currentFromAddress ?? "",
    },
  })

  const kind = form.watch("kind")

  const onSubmit = form.handleSubmit((values) => {
    const payload: SetCompanyMailSettingsInput =
      values.kind === "smtp"
        ? {
            kind: "smtp",
            host: values.host.trim(),
            port: values.port as number,
            secure: values.secure,
            username: values.username.trim(),
            password: values.password,
            fromAddress: values.fromAddress.trim(),
          }
        : {
            kind: "resend",
            apiKey: values.apiKey.trim(),
            fromAddress: values.fromAddress.trim(),
          }

    setMailSettings.mutate(payload, {
      onSuccess: () => {
        toast.success(t("settings.mail.messages.saveSuccess", "Mail server saved"))
        onSaved()
      },
      onError: (error) => {
        toast.error(
          error instanceof ApiError
            ? error.message
            : t("settings.mail.messages.saveError", "Failed to save mail settings"),
        )
      },
    })
  })

  return (
    <SettingsSection
      title={
        currentKind
          ? t("settings.mail.form.updateTitle", "Update your mail server")
          : t("settings.mail.form.connectTitle", "Connect your own mail server")
      }
      dataCy="mail-settings-form-card"
    >
      <Form {...form}>
        {/* `noValidate`: without it, the browser's OWN constraint validation (the `port` input's
            native `min`/`max` below) runs before this `onSubmit` and can cancel the click's submit
            event outright on an out-of-range value — see the port field's own comment in
            `buildSchema` above for the confirmed repro. zod is the only validator this form trusts
            to ever run, on every browser, so its own errors are the only ones a user can see. */}
        <form onSubmit={onSubmit} noValidate data-cy="mail-settings-form">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <FormField
                control={form.control}
                name="kind"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("settings.mail.form.provider", "Provider")}</FormLabel>
                    <FormControl>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger data-cy="mail-settings-provider-select">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="smtp" data-cy="mail-settings-provider-option-smtp">
                            {PROVIDER_LABELS.smtp}
                          </SelectItem>
                          <SelectItem value="resend" data-cy="mail-settings-provider-option-resend">
                            {PROVIDER_LABELS.resend}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {kind === "smtp" ? (
              <>
                <FormField
                  control={form.control}
                  name="host"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("settings.mail.form.host", "SMTP host")}</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="smtp.example.com" data-cy="mail-settings-host-input" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="port"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("settings.mail.form.port", "Port")}</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          min={1}
                          max={65535}
                          placeholder="587"
                          value={field.value ?? ""}
                          onChange={(e) =>
                            field.onChange(e.target.value === "" ? undefined : Number(e.target.value))
                          }
                          data-cy="mail-settings-port-input"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="username"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("settings.mail.form.username", "Username")}</FormLabel>
                      <FormControl>
                        <Input {...field} data-cy="mail-settings-username-input" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("settings.mail.form.password", "Password")}</FormLabel>
                      <FormControl>
                        <Input {...field} type="password" data-cy="mail-settings-password-input" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="sm:col-span-2">
                  <FormField
                    control={form.control}
                    name="secure"
                    render={({ field }) => (
                      <FormItem className="flex flex-col space-y-3">
                        <FormLabel>{t("settings.mail.form.secure", "Use TLS")}</FormLabel>
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            data-cy="mail-settings-secure-switch"
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>
              </>
            ) : (
              <div className="sm:col-span-2">
                <FormField
                  control={form.control}
                  name="apiKey"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("settings.mail.form.apiKey", "Resend API key")}</FormLabel>
                      <FormControl>
                        <Input {...field} type="password" data-cy="mail-settings-apikey-input" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}

            <div className="sm:col-span-2">
              <FormField
                control={form.control}
                name="fromAddress"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("settings.mail.form.fromAddress", "From address")}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="billing@example.com"
                        data-cy="mail-settings-fromaddress-input"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>

          <SettingsFormFooter className="mt-6">
            {showCancel && (
              <Button type="button" variant="ghost" onClick={onCancel} dataCy="mail-settings-cancel-button">
                {t("settings.mail.actions.cancel", "Cancel")}
              </Button>
            )}
            <Button type="submit" loading={setMailSettings.isPending} dataCy="mail-settings-save-button">
              {t("settings.mail.actions.save", "Save")}
            </Button>
          </SettingsFormFooter>
        </form>
      </Form>
    </SettingsSection>
  )
}

/**
 * Company settings → Mail (`/settings/mail`). The backend's own
 * société → instance → refus-nommé cascade (`MailService#sendForCompany`) already governs every
 * send in this repo; without this screen a company had no way to ever reach the "société" branch of
 * it. `GET /api/company/mail-settings` reports status only (`configured`, `kind`, `fromAddress`) —
 * NEVER the SMTP password or Resend API key, which this screen therefore never has to (and never
 * does) render back.
 *
 * The status chip only ever carries two real states — `success` (this company's own server) and
 * `secondary` (falling back to the instance's) — because that is all `CompanyMailSettingsStatus`
 * exposes (a plain `configured` boolean); there is no signal here for "the instance itself has
 * nothing configured either", so a third, `warning` state is not fabricated on the client.
 *
 * "Test send" is offered UNCONDITIONALLY (not only once a company server is configured): it exercises
 * whatever this company's cascade ACTUALLY resolves to right now — its own server if one is set, else
 * the instance's — so it is equally useful for confirming "the instance server works for me" as for
 * "my own server works". `sendTest`'s real failure message (bad credentials, unreachable host, or the
 * named "nothing configured at all" refusal) is what a screen calling anything less than this one
 * would never be able to show.
 */
export default function MailSettings() {
  const { t } = useTranslation()
  const { data: status, isLoading, refetch } = useCompanyMailSettings()
  const clearMailSettings = useClearCompanyMailSettings()
  const testMailSettings = useTestCompanyMailSettings()

  const [editing, setEditing] = useState(false)
  const [confirmRevertOpen, setConfirmRevertOpen] = useState(false)

  const configured = !!status?.configured
  const showForm = editing || !configured

  const handleTest = () => {
    testMailSettings.mutate(undefined, {
      // NOT `result?.message` — the backend's `{ message }` is the generic string every mail send in
      // this app returns ("Email sent successfully", see `MailService#sendForCompany`), never
      // "test"-specific; showing it here would have this button's own success toast never match this
      // screen's own copy. The real-message discipline documented on this component (and on
      // `CompanyMailSettingsService#sendTest`) is about the FAILURE path only — a real provider error is
      // exactly what a "test send" exists to surface; success has nothing provider-specific to show.
      onSuccess: () => {
        toast.success(t("settings.mail.messages.testSuccess", "Test email sent — check your inbox"))
      },
      onError: (error) => {
        toast.error(
          error instanceof ApiError
            ? error.message
            : t("settings.mail.messages.testError", "Failed to send the test email"),
        )
      },
    })
  }

  const handleRevert = () => {
    clearMailSettings.mutate(undefined, {
      onSuccess: () => {
        toast.success(t("settings.mail.messages.revertSuccess", "Reverted to the instance mail server"))
        setConfirmRevertOpen(false)
        setEditing(false)
      },
      onError: (error) => {
        toast.error(
          error instanceof ApiError
            ? error.message
            : t("settings.mail.messages.revertError", "Failed to revert to the instance mail server"),
        )
      },
    })
  }

  return (
    <SettingsPage
      title={t("settings.mail.title", "Mail")}
      description={t(
        "settings.mail.description",
        "By default this company sends through the instance mail server. Define your own to send from your domain.",
      )}
      dataCy="mail-settings-section"
    >
      <SettingsSection
        title={
          <>
            {configured ? (
              <CheckCircle2 className="size-4 text-success-foreground" aria-hidden="true" />
            ) : (
              <Mail className="size-4 text-muted-foreground" aria-hidden="true" />
            )}
            {t("settings.mail.status.title", "Current mail server")}
          </>
        }
        description={
          configured && status?.fromAddress ? (
            <span data-cy="mail-settings-from-address">
              {t("settings.mail.status.fromAddress", "From: {{address}}", { address: status.fromAddress })}
            </span>
          ) : undefined
        }
        aside={
          <Badge variant={configured ? "success" : "secondary"} data-cy="mail-settings-status-badge">
            {isLoading
              ? t("settings.mail.status.loading", "Loading…")
              : configured
                ? t("settings.mail.status.configured", "Company server ({{kind}})", {
                    kind: status?.kind ? PROVIDER_LABELS[status.kind] : "",
                  })
                : t("settings.mail.status.usingInstance", "Using the instance's mail server")}
          </Badge>
        }
        footer={
          <div className="flex flex-wrap items-center gap-2">
            {configured && !editing && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditing(true)}
                dataCy="mail-settings-edit-button"
              >
                {t("settings.mail.actions.edit", "Edit")}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleTest}
              loading={testMailSettings.isPending}
              dataCy="mail-settings-test-button"
            >
              {t("settings.mail.actions.test", "Test send")}
            </Button>
            {configured && (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => setConfirmRevertOpen(true)}
                dataCy="mail-settings-revert-button"
              >
                {t("settings.mail.actions.revert", "Revert to instance server")}
              </Button>
            )}
          </div>
        }
        dataCy="mail-settings-status-card"
      />

      {showForm && !isLoading && (
        <MailSettingsForm
          currentKind={status?.kind}
          currentFromAddress={status?.fromAddress}
          showCancel={configured}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false)
            refetch()
          }}
        />
      )}

      <Dialog open={confirmRevertOpen} onOpenChange={setConfirmRevertOpen}>
        <DialogContent data-cy="mail-settings-revert-confirm-dialog">
          <DialogHeader>
            <DialogTitle>
              {t("settings.mail.revertModal.title", "Revert to the instance mail server?")}
            </DialogTitle>
            <DialogDescription>
              {t(
                "settings.mail.revertModal.description",
                "This clears this company's own mail server. Future sends fall back to the instance's mail server (or fail if the instance has none configured either).",
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmRevertOpen(false)}
              dataCy="mail-settings-revert-cancel-button"
            >
              {t("settings.mail.actions.cancel", "Cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleRevert}
              loading={clearMailSettings.isPending}
              dataCy="mail-settings-revert-confirm-button"
            >
              {t("settings.mail.actions.revert", "Revert to instance server")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsPage>
  )
}
