import { AlertTriangle, ServerCrash } from "lucide-react"
import type React from "react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
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
import { useInstancePreflight, useRequestInstanceResetOtp, useConfirmInstanceReset } from "@/hooks/queries"
import type { ApiError } from "@/hooks/use-api-query"
import { SettingsSection } from "./settings-section"

/** A fixed keyword typed exactly, untranslated on purpose — see `danger.settings.tsx`'s own
 *  `RESET_APP_KEYWORD` header for why (it is a literal string the user re-types, matched
 *  case-sensitively against the backend's own `RESET_INSTANCE_CONFIRMATION_WORD`). Two words, unlike
 *  the company-scoped screen's single "RESET": this action has no one company's name to ask for
 *  instead (there is no single company — that is the whole point), so a longer fixed phrase is the
 *  only extra friction available. */
const RESET_INSTANCE_KEYWORD = "RESET INSTANCE"

/** Same generic-failure detection `danger.settings.tsx#isOtpLockedError` uses — the backend folds
 *  every OTP failure into one message except the permanent lockout, matched on that one stable
 *  substring since it carries no separate error code. */
function isOtpLockedError(error: unknown): boolean {
  return error instanceof Error && /locked/i.test(error.message)
}

/**
 * Settings > Danger Zone's instance-wide reset card — mounted ONLY when `useInstancePreflight()`
 * resolves 200 (backend/src/modules/instance/instance.controller.ts: masked as 404 on SaaS, 403 for
 * anyone not on `INSTANCE_OPERATOR_EMAILS`). Renders nothing otherwise — the same "not isSuccess means
 * this does not exist here" contract `billing.settings.tsx` already holds for `useBillingStatus()`, so
 * a stale bookmark or a config that changed under the viewer never shows a half-populated card.
 */
export default function InstanceResetSection() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data: preflight, isSuccess } = useInstancePreflight()

  const [otpModalOpen, setOtpModalOpen] = useState(false)
  const [otp, setOtp] = useState("")
  const [confirmText, setConfirmText] = useState("")

  const requestOtp = useRequestInstanceResetOtp()
  const confirmReset = useConfirmInstanceReset()

  if (!isSuccess) return null

  const openModal = () => {
    setOtpModalOpen(true)
    setOtp("")
    setConfirmText("")
    requestOtp.mutate(undefined, {
      onSuccess: () => toast.success(t("settings.instanceReset.messages.otpSentSuccess")),
      onError: (error) => {
        if (isOtpLockedError(error)) {
          toast.error(t("settings.instanceReset.messages.otpLockedTitle"), {
            description: t("settings.instanceReset.messages.otpLockedDescription"),
          })
          return
        }
        toast.error(t("settings.instanceReset.messages.otpSentError"), {
          description:
            error instanceof Error ? error.message : t("settings.instanceReset.messages.unexpectedError"),
        })
      },
    })
  }

  const executeReset = () => {
    if (!otp || confirmText !== RESET_INSTANCE_KEYWORD) return
    confirmReset.mutate(
      { otp, confirmationWord: confirmText },
      {
        onSuccess: () => {
          toast.success(t("settings.instanceReset.messages.actionSuccess"))
          setOtpModalOpen(false)
          navigate("/auth/log-out")
        },
        onError: (error: ApiError) => {
          toast.error(t("settings.instanceReset.messages.actionError"), {
            description: error.message || t("settings.instanceReset.messages.unexpectedError"),
          })
        },
      },
    )
  }

  const formatOtp = (value: string) => {
    const cleaned = value.replace(/\D/g, "").slice(0, 8)
    if (cleaned.length <= 4) return cleaned
    return `${cleaned.slice(0, 4)}-${cleaned.slice(4)}`
  }

  const handleOtpChange = (e: React.ChangeEvent<HTMLInputElement>) => setOtp(formatOtp(e.target.value))

  const canConfirm = otp.length === 9 && confirmText === RESET_INSTANCE_KEYWORD

  return (
    <>
      <SettingsSection
        tone="destructive"
        dataCy="instance-reset-card"
        title={
          <>
            <ServerCrash className="size-4 shrink-0" aria-hidden="true" />
            {t("settings.instanceReset.title")}
          </>
        }
        description={t("settings.instanceReset.description")}
        aside={
          <Badge variant="destructive" data-cy="instance-reset-operator-badge">
            {t("settings.instanceReset.badge")}
          </Badge>
        }
        footer={
          <Button
            variant="outline"
            className="w-full border-destructive/30 text-destructive hover:bg-destructive-soft"
            onClick={openModal}
            loading={requestOtp.isPending}
            data-cy="instance-reset-button"
          >
            {t("settings.instanceReset.button")}
          </Button>
        }
      >
        <p className="text-sm text-muted-foreground text-pretty" data-cy="instance-reset-counts">
          {preflight &&
            t("settings.instanceReset.counts", {
              companies: preflight.companies,
              users: preflight.users,
              documents: preflight.documents,
            })}
        </p>
        <p className="mt-2 text-sm text-muted-foreground text-pretty">{t("settings.instanceReset.detail")}</p>
      </SettingsSection>

      <Dialog open={otpModalOpen} onOpenChange={setOtpModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-destructive" aria-hidden="true" />
              {t("settings.instanceReset.modal.title")}
            </DialogTitle>
            <DialogDescription>
              {t("settings.instanceReset.modal.description", { keyword: RESET_INSTANCE_KEYWORD })}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="rounded-lg bg-destructive-soft p-3">
              <p className="text-sm font-medium text-destructive-soft-foreground">
                {t("settings.instanceReset.modal.warning")}
              </p>
              <p className="mt-1 text-xs text-destructive-soft-foreground/80">
                {t("settings.instanceReset.modal.warningDescription")}
              </p>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="instance-reset-otp">{t("settings.instanceReset.modal.otpLabel")}</Label>
              <Input
                id="instance-reset-otp"
                value={otp}
                onChange={handleOtpChange}
                placeholder={t("settings.instanceReset.modal.otpPlaceholder")}
                className="text-center text-lg font-mono tracking-wider"
                maxLength={9}
                data-cy="instance-reset-otp-input"
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="instance-reset-confirm-text">
                {t("settings.instanceReset.modal.confirmLabel", { keyword: RESET_INSTANCE_KEYWORD })}
              </Label>
              <Input
                id="instance-reset-confirm-text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={RESET_INSTANCE_KEYWORD}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                data-cy="instance-reset-confirm-input"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOtpModalOpen(false)}
              data-cy="instance-reset-modal-cancel"
            >
              {t("settings.instanceReset.modal.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={executeReset}
              disabled={!canConfirm}
              loading={confirmReset.isPending}
              data-cy="instance-reset-modal-confirm"
            >
              {t("settings.instanceReset.modal.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
