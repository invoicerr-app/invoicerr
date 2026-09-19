import { AlertTriangle, Lock, RotateCcw, Trash2 } from "lucide-react"
import type React from "react"
import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
import { useGet, usePost } from "@/hooks/use-fetch"
import { SettingsPage, SettingsSection } from "./settings-section"
import InstanceResetSection from "./instance-reset.section"
import TransferCompanySection from "./transfer-company.section"

/** A fixed keyword typed exactly, uppercase — the same "type to confirm" convention every host of a
 *  truly irreversible action uses, kept English/untranslated because it is a literal string the user
 *  re-types (translating it would make the very act of matching it depend on the viewer's locale). */
const RESET_COMPANY_DATA_KEYWORD = "RESET"

type DangerAction = "reset-company-data" | "delete-company"

interface CompanyDataResetPreflight {
  blocked: boolean
  retainedDocuments: number
  retentionUntil: string | null
  counts: {
    documents: number
    clients: number
    articles: number
    projects: number
    timeEntries: number
    bankStatements: number
    archives: number
  }
}

/** The confirm step's own OTP failures stay deliberately generic no matter the cause (wrong code,
 *  expired, or already locked — the backend folds all three into the same message on purpose, so a
 *  caller here can never narrow down a guess). The ONE outcome the backend does surface distinctly is
 *  the permanent lockout on the REQUEST step itself (five failed confirmations, for good) — matched on
 *  the response text since that refusal carries no separate error code, only this one stable phrase. */
function isOtpLockedError(error: unknown): boolean {
  return error instanceof Error && /locked/i.test(error.message)
}

export default function DangerZoneSettings() {
  const { t } = useTranslation()
  const [currentAction, setCurrentAction] = useState<DangerAction | null>(null)
  const [otp, setOtp] = useState("")
  const [confirmText, setConfirmText] = useState("")
  const { trigger: sendOTP, loading: isLoadingOtp, lastError: lastOtpError } = usePost("/api/danger/otp")
  // Read BEFORE the OTP flow ever starts (see this endpoint's own backend description) — the screen
  // must show a document-retention refusal up front, never only after the owner has already typed a
  // confirmation code. Never touches an OTP itself; a plain GET, refetched (`mutate`) after a
  // successful reset so the counts/blocked state shown here never lag behind what the company
  // actually holds.
  const {
    data: preflight,
    loading: preflightLoading,
    mutate: refetchPreflight,
  } = useGet<CompanyDataResetPreflight>("/api/danger/reset/company-data/preflight")
  // The OTP travels in the request BODY only, via `sendAction({ otp, ... })` below — never appended
  // here as a query string. A confirmation code is a bearer secret for the duration of its own
  // window, and a query string lands in nginx access logs and browser history exactly like a
  // password would (see `danger.controller.ts`'s own comment on its `@Body` for the backend side).
  const actionEndpoint =
    currentAction === "delete-company" ? "/api/danger/delete-company" : "/api/danger/reset/company-data"
  const { trigger: sendAction } = usePost(actionEndpoint)
  const [otpModalOpen, setOtpModalOpen] = useState(false)

  const navigate = useNavigate()
  const { companies, activeCompanyId, refetch: refetchSession } = useCompanies()

  // Deleting the company asks for the company's OWN name — the strongest confirmation this screen
  // can ask for, and now checked AGAIN by the backend itself (`DangerService#deleteCompany`), not
  // merely a client-side friction. "Reset company data" keeps every company/account/member row, so a
  // fixed keyword is enough friction for that lesser action. Falls back to the same fixed keyword if
  // the active company's name isn't resolved yet (a slow session fetch, never a normal steady state)
  // rather than leaving the field impossible to satisfy.
  const activeCompanyName = companies.find((c) => c.id === activeCompanyId)?.name
  const confirmKeyword = useMemo(() => {
    if (currentAction === "delete-company" && activeCompanyName) return activeCompanyName
    return RESET_COMPANY_DATA_KEYWORD
  }, [currentAction, activeCompanyName])

  const requestOtp = (action: DangerAction) => {
    setCurrentAction(action)
    setOtpModalOpen(true)
    setOtp("")
    setConfirmText("")
    sendOTP()
      .then((result) => {
        // `usePost`'s own `trigger` never rejects — it swallows HTTP/network failures and resolves
        // `null`, stashing the real error on `lastError` instead (see that hook's own doc comment).
        // Re-throwing here routes a failed request into the `.catch` below, the same way
        // `executeReset` already has to for the confirm step.
        if (!result) {
          throw lastOtpError.current ?? new Error(t("settings.dangerZone.messages.unexpectedError"))
        }
        toast.success(t("settings.dangerZone.messages.otpSentSuccess"))
      })
      .catch((error) => {
        if (isOtpLockedError(error)) {
          toast.error(t("settings.dangerZone.messages.otpLockedTitle"), {
            description: t("settings.dangerZone.messages.otpLockedDescription"),
          })
          return
        }
        toast.error(t("settings.dangerZone.messages.otpSentError"), {
          description:
            error instanceof Error ? error.message : t("settings.dangerZone.messages.unexpectedError"),
        })
      })
  }

  const executeReset = () => {
    if (!currentAction || !otp || confirmText !== confirmKeyword) return

    // "Delete company" sends the typed name ALONG WITH the OTP — the backend validates it against
    // the company's own current name a second time (see `DangerService#deleteCompany`'s own header
    // on why the OTP alone is not proof of which company is being destroyed).
    const payload = currentAction === "delete-company" ? { otp, companyName: confirmText } : { otp }

    sendAction(payload)
      .then((d) => {
        if (!d) {
          throw new Error(t("settings.dangerZone.messages.actionFailed"))
        }
        toast.success(t("settings.dangerZone.messages.actionSuccess"))
        setOtpModalOpen(false)
        setOtp("")
        setConfirmText("")
        if (currentAction === "delete-company") {
          // The company row (and this user's own membership row on it) is gone — re-fetch the
          // session so `activeCompanyId`/`companies` reflect the backend's own fallback (the
          // `customSession` plugin already recomputes both: another remaining company, or `null`
          // when this was the last one). The sidebar's own "no company left" effect
          // (`sidebar.tsx`) picks that up and opens onboarding on its own — nothing here decides
          // that; this screen only makes sure the session is no longer stale before navigating.
          refetchSession().finally(() => navigate("/dashboard"))
        } else {
          refetchPreflight()
          navigate("/dashboard")
        }
        setCurrentAction(null)
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
  const resetBlocked = preflight?.blocked ?? false
  const retentionDate = preflight?.retentionUntil
    ? new Date(preflight.retentionUntil).toLocaleDateString()
    : null

  return (
    <SettingsPage title={t("settings.dangerZone.title")} description={t("settings.dangerZone.description")}>
      <p className="text-sm text-muted-foreground text-pretty">{t("settings.dangerZone.intro")}</p>

      <TransferCompanySection />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Lower severity: reset company data. Warning tone, not destructive — see delete-company
            below for the fully destructive level (the two severities `SettingsSection`'s own `tone`
            keeps). */}
        <SettingsSection
          tone="warning"
          dataCy="danger-reset-company-data-card"
          title={
            <>
              <RotateCcw className="size-4 shrink-0" aria-hidden="true" />
              {t("settings.dangerZone.resetCompanyData.title")}
            </>
          }
          description={t("settings.dangerZone.resetCompanyData.description")}
          footer={
            <Button
              variant="outline"
              className="w-full border-warning-foreground/30 text-warning-foreground hover:bg-warning"
              onClick={() => requestOtp("reset-company-data")}
              loading={isLoadingOtp}
              disabled={resetBlocked || preflightLoading}
              data-cy="danger-reset-company-data-button"
            >
              {t("settings.dangerZone.resetCompanyData.button")}
            </Button>
          }
        >
          <div className="grid gap-3">
            <p className="text-sm text-muted-foreground text-pretty">
              {t("settings.dangerZone.resetCompanyData.detail")}
            </p>
            {preflight && !resetBlocked && (
              <p className="text-xs text-muted-foreground text-pretty" data-cy="danger-reset-counts">
                {t("settings.dangerZone.resetCompanyData.countsSummary", {
                  documents: preflight.counts.documents,
                  clients: preflight.counts.clients,
                  articles: preflight.counts.articles,
                  projects: preflight.counts.projects,
                  timeEntries: preflight.counts.timeEntries,
                  bankStatements: preflight.counts.bankStatements,
                  archives: preflight.counts.archives,
                })}
              </p>
            )}
            {resetBlocked && (
              <Alert variant="destructive" data-cy="danger-retention-blocked-alert">
                <Lock aria-hidden="true" />
                <AlertTitle>{t("settings.dangerZone.resetCompanyData.retentionBlockedTitle")}</AlertTitle>
                <AlertDescription>
                  {t("settings.dangerZone.resetCompanyData.retentionBlockedDescription", {
                    count: preflight?.retainedDocuments ?? 0,
                    date: retentionDate,
                  })}
                </AlertDescription>
              </Alert>
            )}
          </div>
        </SettingsSection>

        <SettingsSection
          tone="destructive"
          dataCy="danger-delete-company-card"
          title={
            <>
              <Trash2 className="size-4 shrink-0" aria-hidden="true" />
              {t("settings.dangerZone.deleteCompany.title")}
            </>
          }
          description={t("settings.dangerZone.deleteCompany.description")}
          footer={
            <Button
              variant="outline"
              className="w-full border-destructive/30 text-destructive hover:bg-destructive-soft"
              onClick={() => requestOtp("delete-company")}
              loading={isLoadingOtp}
              data-cy="danger-delete-company-button"
            >
              {t("settings.dangerZone.deleteCompany.button")}
            </Button>
          }
        >
          <p className="text-sm text-muted-foreground text-pretty">
            {t("settings.dangerZone.deleteCompany.detail")}
          </p>
        </SettingsSection>
      </div>

      <InstanceResetSection />

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
                  {currentAction === "reset-company-data"
                    ? t("settings.dangerZone.modal.warningResetCompanyData")
                    : t("settings.dangerZone.modal.warningDeleteCompany")}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {currentAction === "reset-company-data"
                    ? t("settings.dangerZone.modal.warningResetCompanyDataDescription")
                    : t("settings.dangerZone.modal.warningDeleteCompanyDescription")}
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
