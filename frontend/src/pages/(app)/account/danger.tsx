import { AlertTriangle, LogOut } from "lucide-react"
import { useState } from "react"
import { Link, useNavigate } from "react-router"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useCompanies } from "@/hooks/queries"
import { type ApiHookError, useDelete } from "@/hooks/use-fetch"
import { afterCompanyGone } from "@/lib/after-company-gone"
import { authClient } from "@/lib/auth"
import { useHasCredentialAccount } from "./_components/use-has-credential-account"
import { SettingsSection } from "../settings/_components/settings-section"

/** The exact shape depends on how the backend's `user.deleteUser.beforeDelete` hook reports the
 *  refusal — checked defensively on both a `code` field (this repo's own convention for a
 *  machine-readable refusal, e.g. `COMPANY_BLOCKED` — see `use-api-query.ts`'s own comment) and a
 *  plain substring of `message`, so this still works whichever one the backend actually sends. */
function isSoleOwnerError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  return error.code === "ACCOUNT_IS_SOLE_OWNER" || Boolean(error.message?.includes("ACCOUNT_IS_SOLE_OWNER"))
}

/** Named so this screen can branch on the backend's own refusal (`companies.service.ts`'s exported
 *  `LAST_OWNER_CANNOT_LEAVE_CODE`) without string-matching its message — the leave-company sibling
 *  of `isSoleOwnerError` just above, for the SAME underlying fact (a company can never end up with
 *  no owner) reached through a different door. */
function isLastOwnerLeaveError(error: { code?: string } | null | undefined): boolean {
  return error?.code === "LAST_OWNER_CANNOT_LEAVE"
}

export default function AccountDangerPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [hasCredentialAccount] = useHasCredentialAccount()

  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [soleOwner, setSoleOwner] = useState(false)

  const openDialog = () => {
    setPassword("")
    setSoleOwner(false)
    setOpen(true)
  }

  // "Leave company" lives HERE, not in the (OWNER/ADMIN-only) Members settings screen — this is the
  // one page in the app every role, including a plain MEMBER, can always reach (`account/_layout.tsx`
  // carries no role gate at all), and leaving is fundamentally about MY OWN relationship to a
  // company, not about administering it. Operates on the session's ACTIVE company — same company the
  // backend's `DELETE /api/companies/leave` (`@ActiveCompany()`) already scopes to.
  const { companies, activeCompanyId } = useCompanies()
  const activeCompany = companies.find((c) => c.id === activeCompanyId)

  const [leaveOpen, setLeaveOpen] = useState(false)
  const [leaveLastOwner, setLeaveLastOwner] = useState(false)
  const {
    trigger: leaveCompanyApi,
    loading: leavingCompany,
    lastError: leaveLastError,
  } = useDelete<{ success: boolean }>("/api/companies/leave")

  const openLeaveDialog = () => {
    setLeaveLastOwner(false)
    setLeaveOpen(true)
  }

  const handleLeaveCompany = async () => {
    const result = await leaveCompanyApi()
    if (!result) {
      // `useDelete`'s own `trigger` never rejects (see use-fetch.ts's own doc comment) — the real
      // failure, including the backend's `code`, lands on `lastError` instead.
      const err: ApiHookError | null = leaveLastError.current
      if (isLastOwnerLeaveError(err)) {
        setLeaveLastOwner(true)
        return
      }
      toast.error(err?.message || t("account.leaveCompany.messages.error"))
      return
    }
    setLeaveOpen(false)
    toast.success(t("account.leaveCompany.messages.success"))
    // The company this screen was just reading is gone for this user — see this helper's own
    // header for why a plain SPA navigate would leave half the app showing stale, cached data for
    // it (the exact same reload `danger.settings.tsx`'s own "Delete company" hands off to).
    afterCompanyGone()
  }

  const handleDelete = async () => {
    setSubmitting(true)

    const { error } = hasCredentialAccount
      ? await authClient.deleteUser({ password })
      : await authClient.deleteUser({ callbackURL: `${window.location.origin}/` })

    setSubmitting(false)

    const err = error as { code?: string; message?: string } | null
    if (err) {
      if (isSoleOwnerError(err)) {
        setSoleOwner(true)
        return
      }
      toast.error(err.message || t("account.danger.messages.error"))
      return
    }

    setOpen(false)
    if (hasCredentialAccount) {
      toast.success(t("account.danger.messages.success"))
      navigate("/auth/sign-in")
    } else {
      toast.success(t("account.danger.messages.emailSent"))
    }
  }

  return (
    <div className="grid gap-6">
      {/* Only rendered once there IS an active company to leave — a brand-new account with zero
          memberships (e.g. mid-onboarding) has nothing here to act on. */}
      {activeCompany && (
        <SettingsSection
          tone="warning"
          title={
            <>
              <LogOut className="size-4" aria-hidden="true" />
              {t("account.leaveCompany.card.title")}
            </>
          }
          description={t("account.leaveCompany.card.description", { company: activeCompany.name })}
          dataCy="account-leave-company-card"
        >
          <Button
            variant="outline"
            className="border-warning-foreground/30 text-warning-foreground hover:bg-warning"
            onClick={openLeaveDialog}
            data-cy="account-leave-company-button"
          >
            {t("account.leaveCompany.card.button")}
          </Button>

          <Dialog open={leaveOpen} onOpenChange={setLeaveOpen}>
            <DialogContent className="sm:max-w-md" data-cy="account-leave-company-dialog">
              <DialogHeader>
                <DialogTitle>
                  {t("account.leaveCompany.dialog.title", { company: activeCompany.name })}
                </DialogTitle>
                <DialogDescription>{t("account.leaveCompany.dialog.description")}</DialogDescription>
              </DialogHeader>

              {leaveLastOwner && (
                <div className="rounded-md bg-muted p-3" data-cy="account-leave-company-sole-owner-notice">
                  <p className="text-sm font-medium">{t("account.leaveCompany.soleOwner.title")}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t("account.leaveCompany.soleOwner.description")}
                  </p>
                  <Link
                    to="/settings/danger"
                    className="mt-2 inline-block text-sm font-medium text-primary hover:underline"
                  >
                    {t("account.leaveCompany.soleOwner.link")}
                  </Link>
                </div>
              )}

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setLeaveOpen(false)}
                  data-cy="account-leave-company-cancel"
                >
                  {t("account.leaveCompany.dialog.cancel")}
                </Button>
                {!leaveLastOwner && (
                  <Button
                    variant="destructive"
                    onClick={handleLeaveCompany}
                    loading={leavingCompany}
                    data-cy="account-leave-company-confirm"
                  >
                    {t("account.leaveCompany.dialog.confirm")}
                  </Button>
                )}
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </SettingsSection>
      )}

      <SettingsSection
        tone="destructive"
        title={
          <>
            <AlertTriangle className="size-4" aria-hidden="true" />
            {t("account.danger.card.title")}
          </>
        }
        description={t("account.danger.card.description")}
        dataCy="account-danger-card"
      >
        <Button variant="destructive" onClick={openDialog} data-cy="account-danger-delete-button">
          {t("account.danger.card.button")}
        </Button>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="sm:max-w-md" data-cy="account-danger-dialog">
            <DialogHeader>
              <DialogTitle>{t("account.danger.dialog.title")}</DialogTitle>
              <DialogDescription>{t("account.danger.dialog.description")}</DialogDescription>
            </DialogHeader>

            {soleOwner ? (
              <div className="rounded-md bg-muted p-3" data-cy="account-danger-sole-owner-notice">
                <p className="text-sm font-medium">{t("account.danger.messages.soleOwner.title")}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("account.danger.messages.soleOwner.description")}
                </p>
                <Link
                  to="/settings/members"
                  className="mt-2 inline-block text-sm font-medium text-primary hover:underline"
                >
                  {t("account.danger.messages.soleOwner.link")}
                </Link>
              </div>
            ) : hasCredentialAccount ? (
              <div className="grid gap-2">
                <Label htmlFor="account-danger-password">{t("account.danger.dialog.passwordLabel")}</Label>
                <Input
                  id="account-danger-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t("account.danger.dialog.passwordPlaceholder")}
                  data-cy="account-danger-password-input"
                />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t("account.danger.dialog.ssoNotice")}</p>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                {t("account.danger.dialog.cancel")}
              </Button>
              {!soleOwner && (
                <Button
                  variant="destructive"
                  onClick={handleDelete}
                  loading={submitting}
                  disabled={hasCredentialAccount === null || (hasCredentialAccount && password.length === 0)}
                  data-cy="account-danger-confirm-button"
                >
                  {submitting ? t("account.danger.dialog.confirming") : t("account.danger.dialog.confirm")}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SettingsSection>
    </div>
  )
}
