import { QRCodeSVG } from "qrcode.react"
import type React from "react"
import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { SettingsSection } from "@/components/settings-section"
import { TotpCodeInput } from "@/components/totp-code-input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { authClient } from "@/lib/auth"
import { copyToClipboard } from "@/lib/clipboard"

/** The base32 secret inside an `otpauth://` URI, for people who type it instead of scanning. */
export function secretFromTotpUri(uri: string): string {
  try {
    return new URL(uri).searchParams.get("secret") ?? ""
  } catch {
    return ""
  }
}

type Step =
  | { kind: "idle" }
  | { kind: "scan"; totpURI: string; backupCodes: string[] }
  | { kind: "codes"; backupCodes: string[] }

/**
 * Authenticator-app (TOTP) second factor for a password account, backed by better-auth's two-factor
 * plugin (backend `lib/two-factor-options.ts`). Every change asks for the current password: the
 * backend refuses it otherwise, so a stolen session alone cannot turn the second factor off.
 */
export function TwoFactorSection({
  hasCredentialAccount,
  demoMode,
}: Readonly<{ hasCredentialAccount: boolean | null; demoMode: boolean }>) {
  const { t } = useTranslation()
  const { data: session, refetch } = authClient.useSession()
  const enabled =
    (session?.user as { twoFactorEnabled?: boolean | null } | undefined)?.twoFactorEnabled === true
  const [password, setPassword] = useState("")
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState<Step>({ kind: "idle" })

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    try {
      await action()
    } finally {
      setBusy(false)
    }
  }

  const start = (event: React.FormEvent) => {
    event.preventDefault()
    void run(async () => {
      const { data, error } = await authClient.twoFactor.enable({ password })
      if (error || !data || !("totpURI" in data) || !data.totpURI) {
        toast.error(error?.message || t("account.security.twoFactor.messages.error"))
        return
      }
      setPassword("")
      setStep({ kind: "scan", totpURI: data.totpURI, backupCodes: data.backupCodes ?? [] })
    })
  }

  // The sixth digit submits on its own, and the button stays for anyone who prefers it: this guard
  // keeps the two from sending the same code twice.
  const verifying = useRef(false)
  const verifyCode = (value: string) => {
    if (step.kind !== "scan" || verifying.current) return
    verifying.current = true
    void run(async () => {
      try {
        const { error } = await authClient.twoFactor.verifyTotp({ code: value })
        if (error) {
          // Emptied so the next six digits submit again.
          setCode("")
          toast.error(error.message || t("account.security.twoFactor.messages.invalidCode"))
          return
        }
        setCode("")
        setStep({ kind: "codes", backupCodes: step.backupCodes })
        toast.success(t("account.security.twoFactor.messages.enabled"))
        await refetch()
      } finally {
        verifying.current = false
      }
    })
  }

  const confirm = (event: React.FormEvent) => {
    event.preventDefault()
    verifyCode(code)
  }

  const disable = () =>
    run(async () => {
      const { error } = await authClient.twoFactor.disable({ password })
      if (error) {
        toast.error(error.message || t("account.security.twoFactor.messages.error"))
        return
      }
      setPassword("")
      setStep({ kind: "idle" })
      toast.success(t("account.security.twoFactor.messages.disabled"))
      await refetch()
    })

  const regenerate = () =>
    run(async () => {
      const { data, error } = await authClient.twoFactor.generateBackupCodes({ password })
      if (error || !data) {
        toast.error(error?.message || t("account.security.twoFactor.messages.error"))
        return
      }
      setPassword("")
      setStep({ kind: "codes", backupCodes: data.backupCodes })
    })

  const demoTooltip = demoMode ? t("demo.disabledTooltip", "Disabled in this demo.") : undefined

  const passwordField = (
    <div className="grid gap-1.5">
      <Label htmlFor="two-factor-password">{t("account.security.twoFactor.password")}</Label>
      <Input
        id="two-factor-password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        data-cy="two-factor-password-input"
      />
    </div>
  )

  return (
    <SettingsSection
      title={t("account.security.twoFactor.title")}
      description={t("account.security.twoFactor.description")}
      aside={
        enabled ? (
          <Badge variant="success" data-cy="two-factor-status">
            {t("account.security.twoFactor.on")}
          </Badge>
        ) : (
          <Badge variant="outline" data-cy="two-factor-status">
            {t("account.security.twoFactor.off")}
          </Badge>
        )
      }
      dataCy="two-factor-card"
    >
      {hasCredentialAccount === false ? (
        <p className="text-sm text-muted-foreground" data-cy="two-factor-needs-password">
          {t("account.security.twoFactor.needsPassword")}
        </p>
      ) : step.kind === "scan" ? (
        <form onSubmit={confirm} className="grid gap-4 sm:max-w-sm">
          <p className="text-sm text-muted-foreground">{t("account.security.twoFactor.scan")}</p>
          <div className="w-fit rounded-md bg-white p-3">
            <QRCodeSVG value={step.totpURI} size={176} title={t("account.security.twoFactor.qrAlt")} />
          </div>
          <div className="grid gap-1.5">
            <span className="text-sm text-muted-foreground">{t("account.security.twoFactor.secret")}</span>
            <code
              className="break-all rounded bg-muted px-2 py-1 font-mono text-sm"
              data-cy="two-factor-secret"
            >
              {secretFromTotpUri(step.totpURI)}
            </code>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="two-factor-code">{t("account.security.twoFactor.code")}</Label>
            <TotpCodeInput
              id="two-factor-code"
              value={code}
              onChange={setCode}
              onComplete={verifyCode}
              data-cy="two-factor-setup-code-input"
            />
          </div>
          <div className="flex gap-2">
            <Button
              type="submit"
              loading={busy}
              disabled={code.length < 6}
              data-cy="two-factor-confirm"
            >
              {t("account.security.twoFactor.confirm")}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setStep({ kind: "idle" })}>
              {t("account.security.twoFactor.cancel")}
            </Button>
          </div>
        </form>
      ) : step.kind === "codes" ? (
        <div className="grid gap-4 sm:max-w-sm" data-cy="two-factor-backup-codes">
          <p className="text-sm text-muted-foreground">{t("account.security.twoFactor.backupCodes")}</p>
          <ul className="grid grid-cols-2 gap-1 rounded bg-muted p-3 font-mono text-sm">
            {step.backupCodes.map((backupCode) => (
              <li key={backupCode} data-cy="two-factor-backup-code">
                {backupCode}
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                if (await copyToClipboard(step.backupCodes.join("\n"))) {
                  toast.success(t("account.security.twoFactor.messages.copied"))
                }
              }}
            >
              {t("account.security.twoFactor.copy")}
            </Button>
            <Button type="button" onClick={() => setStep({ kind: "idle" })} data-cy="two-factor-done">
              {t("account.security.twoFactor.done")}
            </Button>
          </div>
        </div>
      ) : enabled ? (
        <div className="grid gap-4 sm:max-w-sm">
          {passwordField}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              loading={busy}
              disabled={demoMode || password.length === 0}
              tooltip={demoTooltip}
              onClick={() => void regenerate()}
              data-cy="two-factor-regenerate"
            >
              {t("account.security.twoFactor.regenerate")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              loading={busy}
              disabled={demoMode || password.length === 0}
              tooltip={demoTooltip}
              onClick={() => void disable()}
              data-cy="two-factor-disable"
            >
              {t("account.security.twoFactor.disable")}
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={start} className="grid gap-4 sm:max-w-sm">
          {passwordField}
          <div>
            <Button
              type="submit"
              loading={busy}
              disabled={demoMode || password.length === 0}
              tooltip={demoTooltip}
              data-cy="two-factor-enable"
            >
              {t("account.security.twoFactor.enable")}
            </Button>
          </div>
        </form>
      )}
    </SettingsSection>
  )
}
