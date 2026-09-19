import { AlertTriangle, ArrowRightLeft } from "lucide-react"
import type React from "react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { ConfirmationDialog } from "@/components/confirmation-dialog"
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
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError } from "@/hooks/use-api-query"
import {
  useCancelCompanyTransfer,
  useCurrentCompanyTransfer,
  useInitiateTransfer,
  useRequestTransferOtp,
} from "@/hooks/queries"
import { SettingsSection } from "./settings-section"

function formatOtp(value: string): string {
  const cleaned = value.replace(/\D/g, "").slice(0, 8)
  if (cleaned.length <= 4) return cleaned
  return `${cleaned.slice(0, 4)}-${cleaned.slice(4)}`
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

/**
 * Mounted inside `danger.settings.tsx` (that file's own `{/* transfer-company section mounts here *\/}`
 * marker) — not a route of its own. OWNER-only in practice: the backend's `TransferController` is
 * `@Roles(OWNER)`, so an ADMIN/MEMBER never reaches a state where this component has anything to show
 * (the page hosting it is itself gated the same way the rest of the danger zone is).
 *
 * The OTP step reuses the SAME `POST /danger/otp` challenge the reset actions above it on that page
 * use — see `backend/src/modules/company/transfer/danger-otp-check.ts`'s own header — so requesting a
 * code here and confirming a reset there (or vice versa) would invalidate each other's code; that is
 * the existing, one-challenge-per-company behavior, unchanged by this feature.
 */
export default function TransferCompanySection() {
  const { t } = useTranslation()
  const { data: current, isPending: currentPending } = useCurrentCompanyTransfer()
  const requestOtp = useRequestTransferOtp()
  const initiate = useInitiateTransfer()
  const cancel = useCancelCompanyTransfer()

  const [email, setEmail] = useState("")
  const [otp, setOtp] = useState("")
  const [otpDialogOpen, setOtpDialogOpen] = useState(false)
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false)

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())

  const handleStart = () => {
    if (!emailValid) {
      toast.error(t("settings.transferCompany.messages.invalidEmail"))
      return
    }
    requestOtp.mutate(undefined, {
      onSuccess: () => {
        setOtp("")
        setOtpDialogOpen(true)
      },
      onError: (error) => {
        toast.error(
          error instanceof ApiError ? error.message : t("settings.transferCompany.messages.otpSentError"),
        )
      },
    })
  }

  const handleConfirm = () => {
    initiate.mutate(
      { email: email.trim(), otp },
      {
        onSuccess: () => {
          // The identical, anti-enumeration copy whether or not the address had an account — see
          // `transfer.service.ts`'s own header. Deliberately our OWN translated string, never the
          // server's raw (always-English) `message`, so it reads correctly whatever locale is active.
          toast.success(t("settings.transferCompany.messages.initiateSuccess"))
          setOtpDialogOpen(false)
          setEmail("")
          setOtp("")
        },
        onError: (error) => {
          toast.error(
            error instanceof ApiError ? error.message : t("settings.transferCompany.messages.initiateError"),
          )
        },
      },
    )
  }

  const handleCancel = () => {
    if (!current) return
    cancel.mutate(
      { id: current.id },
      {
        onSuccess: () => {
          toast.success(t("settings.transferCompany.messages.cancelSuccess"))
          setCancelDialogOpen(false)
        },
        onError: (error) => {
          setCancelDialogOpen(false)
          toast.error(
            error instanceof ApiError ? error.message : t("settings.transferCompany.messages.cancelError"),
          )
        },
      },
    )
  }

  const handleOtpChange = (e: React.ChangeEvent<HTMLInputElement>) => setOtp(formatOtp(e.target.value))

  return (
    <SettingsSection
      tone="warning"
      dataCy="transfer-company-card"
      title={
        <>
          <ArrowRightLeft className="size-4 shrink-0" aria-hidden="true" />
          {t("settings.transferCompany.title")}
        </>
      }
      description={t("settings.transferCompany.description")}
    >
      {currentPending ? (
        <div className="grid gap-2" data-cy="transfer-company-loading">
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-9 w-40" />
        </div>
      ) : current ? (
        <div className="grid gap-3">
          <div className="rounded-lg bg-muted p-3 text-sm" data-cy="transfer-company-pending">
            <p className="font-medium text-foreground">
              {t("settings.transferCompany.current.recipientLabel")}: {current.toEmail}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("settings.transferCompany.current.requestedAt")}:{" "}
              <span className="font-mono tabular-nums">{formatDate(current.createdAt)}</span>
              {" · "}
              {t("settings.transferCompany.current.expiresAt")}:{" "}
              <span className="font-mono tabular-nums">{formatDate(current.expiresAt)}</span>
            </p>
          </div>
          <Button
            variant="outline"
            className="w-fit border-warning-foreground/30 text-warning-foreground hover:bg-warning"
            onClick={() => setCancelDialogOpen(true)}
            data-cy="transfer-company-cancel-button"
          >
            {t("settings.transferCompany.current.cancel")}
          </Button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="grid gap-1.5">
            <Label htmlFor="transfer-company-email">{t("settings.transferCompany.form.emailLabel")}</Label>
            <Input
              id="transfer-company-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("settings.transferCompany.form.emailPlaceholder")}
              data-cy="transfer-company-email-input"
            />
            <p className="text-xs text-muted-foreground">{t("settings.transferCompany.form.emailHint")}</p>
          </div>
          <Button
            variant="outline"
            className="border-warning-foreground/30 text-warning-foreground hover:bg-warning"
            onClick={handleStart}
            loading={requestOtp.isPending}
            disabled={!emailValid}
            data-cy="transfer-company-start-button"
          >
            {t("settings.transferCompany.form.submit")}
          </Button>
        </div>
      )}

      <Dialog open={otpDialogOpen} onOpenChange={setOtpDialogOpen}>
        <DialogContent className="sm:max-w-md" dataCy="transfer-company-otp-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-warning-foreground" aria-hidden="true" />
              {t("settings.transferCompany.otpDialog.title")}
            </DialogTitle>
            <DialogDescription>
              {t("settings.transferCompany.otpDialog.description", { email: email.trim() })}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="transfer-company-otp">{t("settings.transferCompany.otpDialog.otpLabel")}</Label>
            <Input
              id="transfer-company-otp"
              value={otp}
              onChange={handleOtpChange}
              placeholder={t("settings.transferCompany.otpDialog.otpPlaceholder")}
              className="text-center text-lg font-mono tracking-wider"
              maxLength={9}
              data-cy="transfer-company-otp-input"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOtpDialogOpen(false)}
              dataCy="transfer-company-otp-cancel"
            >
              {t("settings.transferCompany.otpDialog.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirm}
              disabled={otp.length !== 9}
              loading={initiate.isPending}
              dataCy="transfer-company-otp-confirm"
            >
              {t("settings.transferCompany.otpDialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmationDialog
        open={cancelDialogOpen}
        onOpenChange={setCancelDialogOpen}
        title={t("settings.transferCompany.cancelDialog.title")}
        description={t("settings.transferCompany.cancelDialog.description")}
        confirmLabel={t("settings.transferCompany.cancelDialog.confirm")}
        cancelLabel={t("settings.transferCompany.cancelDialog.cancel")}
        onConfirm={handleCancel}
        loading={cancel.isPending}
        dataCy="transfer-company-cancel-dialog"
      />
    </SettingsSection>
  )
}
