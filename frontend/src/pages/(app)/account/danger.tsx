import { AlertTriangle } from "lucide-react"
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
  )
}
