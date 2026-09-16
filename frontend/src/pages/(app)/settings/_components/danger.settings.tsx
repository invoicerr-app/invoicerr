import { AlertTriangle, Database, RotateCcw } from "lucide-react"
import type React from "react"
import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router"
import { toast } from "sonner"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useCompanies } from "@/hooks/queries"
import { usePost } from "@/hooks/use-fetch"
import { SettingsPage, SettingsSection } from "./settings-section"

/** A fixed keyword typed exactly, uppercase — the same "type to confirm" convention every host of a
 *  truly irreversible action uses, kept English/untranslated because it is a literal string the user
 *  re-types (translating it would make the very act of matching it depend on the viewer's locale). */
const RESET_APP_KEYWORD = "RESET"

export default function DangerZoneSettings() {
  const { t } = useTranslation()
  const [currentAction, setCurrentAction] = useState<"app" | "all" | null>(null)
  const [otp, setOtp] = useState("")
  const [confirmText, setConfirmText] = useState("")
  const { trigger: sendOTP, loading: isLoadingOtp } = usePost("/api/danger/otp")
  const { trigger: sendAction } = usePost(`/api/danger/reset/${currentAction}?otp=${otp}`)
  const [otpModalOpen, setOtpModalOpen] = useState(false)

  const navigate = useNavigate()
  const { companies, activeCompanyId } = useCompanies()

  // Deleting the company (`all`) asks for the company's OWN name — the strongest confirmation this
  // screen can ask for without a new endpoint (see this file's own header on why: nothing here is
  // allowed to invent one). `resetApp` keeps every company/account/member row, so a fixed keyword is
  // enough friction for that lesser action. Falls back to the same fixed keyword if the active
  // company's name isn't resolved yet (a slow session fetch, never a normal steady state) rather than
  // leaving the field impossible to satisfy.
  const activeCompanyName = companies.find((c) => c.id === activeCompanyId)?.name
  const confirmKeyword = useMemo(() => {
    if (currentAction === "all" && activeCompanyName) return activeCompanyName
    return RESET_APP_KEYWORD
  }, [currentAction, activeCompanyName])

  const requestOtp = (action: "app" | "all") => {
    setCurrentAction(action)
    setOtpModalOpen(true)
    setOtp("")
    setConfirmText("")
    sendOTP()
      .then(() => {
        toast.success(t("settings.dangerZone.messages.otpSentSuccess"))
      })
      .catch((error) => {
        toast.error(t("settings.dangerZone.messages.otpSentError"), {
          description:
            error instanceof Error ? error.message : t("settings.dangerZone.messages.unexpectedError"),
        })
      })
  }

  const executeReset = () => {
    if (!currentAction || !otp || confirmText !== confirmKeyword) return

    sendAction({ otp })
      .then((d) => {
        if (!d) {
          throw new Error(t("settings.dangerZone.messages.actionFailed"))
        }
        toast.success(t("settings.dangerZone.messages.actionSuccess"))
        setOtpModalOpen(false)
        setOtp("")
        setConfirmText("")
        setCurrentAction(null)
        if (currentAction === "all") {
          navigate("/auth/log-out")
        } else {
          navigate("/dashboard")
        }
      })
      .catch((error) => {
        toast.error(t("settings.dangerZone.messages.actionError"), {
          description:
            error instanceof Error ? error.message : t("settings.dangerZone.messages.unexpectedError"),
        })
      })
  }

  const formatOtp = (value: string) => {
    const cleaned = value.replace(/\D/g, "").slice(0, 8)
    if (cleaned.length <= 4) return cleaned
    return `${cleaned.slice(0, 4)}-${cleaned.slice(4)}`
  }

  const handleOtpChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setOtp(formatOtp(e.target.value))
  }

  const canConfirm = otp.length === 9 && confirmText === confirmKeyword

  return (
    <SettingsPage title={t("settings.dangerZone.title")} description={t("settings.dangerZone.description")}>
      <p className="text-sm text-muted-foreground text-pretty">{t("settings.dangerZone.intro")}</p>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Lower severity: reset app data. Warning tone, not destructive — see resetDatabase below
            for the fully destructive level (the two severities `SettingsSection`'s own `tone` keeps). */}
        <SettingsSection
          tone="warning"
          dataCy="danger-reset-app-card"
          title={
            <>
              <RotateCcw className="size-4 shrink-0" aria-hidden="true" />
              {t("settings.dangerZone.resetApp.title")}
            </>
          }
          description={t("settings.dangerZone.resetApp.description")}
          footer={
            <Button
              variant="outline"
              className="w-full border-warning-foreground/30 text-warning-foreground hover:bg-warning"
              onClick={() => requestOtp("app")}
              loading={isLoadingOtp}
              data-cy="danger-reset-app-button"
            >
              {t("settings.dangerZone.resetApp.button")}
            </Button>
          }
        >
          <p className="text-sm text-muted-foreground text-pretty">
            {t("settings.dangerZone.resetApp.detail")}
          </p>
        </SettingsSection>

        <SettingsSection
          tone="destructive"
          dataCy="danger-reset-database-card"
          title={
            <>
              <Database className="size-4 shrink-0" aria-hidden="true" />
              {t("settings.dangerZone.resetDatabase.title")}
            </>
          }
          description={t("settings.dangerZone.resetDatabase.description")}
          footer={
            <Button
              variant="outline"
              className="w-full border-destructive/30 text-destructive hover:bg-destructive-soft"
              onClick={() => requestOtp("all")}
              loading={isLoadingOtp}
              data-cy="danger-reset-database-button"
            >
              {t("settings.dangerZone.resetDatabase.button")}
            </Button>
          }
        >
          <p className="text-sm text-muted-foreground text-pretty">
            {t("settings.dangerZone.resetDatabase.detail")}
          </p>
        </SettingsSection>
      </div>

      <Dialog open={otpModalOpen} onOpenChange={setOtpModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-warning-foreground" aria-hidden="true" />
              {t("settings.dangerZone.modal.title")}
            </DialogTitle>
            <DialogDescription>{t("settings.dangerZone.modal.description")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            {currentAction && (
              <div className="rounded-lg bg-muted p-3">
                <p className="text-sm font-medium text-foreground">
                  {currentAction === "app"
                    ? t("settings.dangerZone.modal.warningApp")
                    : t("settings.dangerZone.modal.warningDatabase")}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {currentAction === "app"
                    ? t("settings.dangerZone.modal.warningAppDescription")
                    : t("settings.dangerZone.modal.warningDatabaseDescription")}
                </p>
              </div>
            )}

            <div className="grid gap-1.5">
              <Label htmlFor="otp">{t("settings.dangerZone.modal.otpLabel")}</Label>
              <Input
                id="otp"
                value={otp}
                onChange={handleOtpChange}
                placeholder={t("settings.dangerZone.modal.otpPlaceholder")}
                className="text-center text-lg font-mono tracking-wider"
                maxLength={9}
                data-cy="danger-otp-input"
              />
            </div>

            {/* Type-to-confirm: the irreversible button below stays disabled until this matches the
                keyword EXACTLY (case-sensitive) — the same friction GitHub-style repo deletion uses,
                so a reflexive click on the OTP dialog can never fire the actual reset. */}
            <div className="grid gap-1.5">
              <Label htmlFor="danger-confirm-text">
                {t("settings.dangerZone.modal.confirmLabel", "Type {{keyword}} to confirm", {
                  keyword: confirmKeyword,
                })}
              </Label>
              <Input
                id="danger-confirm-text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={confirmKeyword}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                data-cy="danger-confirm-input"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOtpModalOpen(false)} data-cy="danger-modal-cancel">
              {t("settings.dangerZone.modal.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={executeReset}
              disabled={!canConfirm}
              data-cy="danger-modal-confirm"
            >
              {t("settings.dangerZone.modal.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsPage>
  )
}
