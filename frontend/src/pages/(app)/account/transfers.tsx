import { Building2, CheckCircle2, History } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router"
import { toast } from "sonner"

import { ConfirmationDialog } from "@/components/confirmation-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { ApiError } from "@/hooks/use-api-query"
import { useAcceptCompanyTransfer, useReceivedTransfers, type OwnershipTransferView } from "@/hooks/queries"
import { authClient } from "@/lib/auth"
import {
  SettingsIconDisc,
  SettingsList,
  SettingsListRow,
  SettingsListSkeleton,
  SettingsSection,
} from "../settings/_components/settings-section"

/** Mirrors `backend/src/lib/legal-signup-policy.ts#LEGAL_ACCEPTANCE_REQUIRED_CODE` by name — the four
 *  projects in this repo share no package (CLAUDE.md), so this is the one place the frontend has to
 *  name it by hand, the same `use-mutation-with-toast.ts#COMPANY_BLOCKED_CODE` treatment any named
 *  backend error code gets. Refused by the GLOBAL `LegalAcceptanceGuard` (hosted-billing mode only)
 *  before `POST /account/transfers/:id/accept` ever runs — see that endpoint's own backend header. */
const LEGAL_ACCEPTANCE_REQUIRED_CODE = "LEGAL_ACCEPTANCE_REQUIRED"

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

function statusBadgeVariant(
  status: OwnershipTransferView["status"],
): "success" | "destructive" | "secondary" {
  if (status === "ACCEPTED") return "success"
  if (status === "EXPIRED" || status === "CANCELED") return "destructive"
  return "secondary"
}

/**
 * `/account/transfers` — every company ownership transfer addressed to the signed-in user's account
 * (product decision 2026-09-17). Reached from the emailed request link
 * (`buildOwnershipTransferRequestEmail`, backend); nests under `account/_layout.tsx`'s shared shell
 * like every other `/account/*` page, so it deliberately draws no page title of its own — the tab
 * strip's own chrome already frames it (see `index.tsx`/`danger.tsx` for the same convention).
 *
 * The legal-acceptance gate (SaaS mode) is enforced SERVER-SIDE, not here: this screen never checks
 * `useLegalStatus` itself — it just catches the accept mutation's own `LEGAL_ACCEPTANCE_REQUIRED`
 * refusal and sends the visitor to `/legal/accept`. `/legal/accept` itself always returns to
 * `/dashboard` on success (its own existing behavior) rather than back here — the pending transfer is
 * untouched either way, so returning to this page afterward (the sidebar's own "My account" entry, or
 * the same email link again) simply lets the accept succeed on the next click.
 */
export default function AccountTransfersPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { refetch: refetchSession } = authClient.useSession()
  const { data: transfers, isPending } = useReceivedTransfers()
  const acceptMutation = useAcceptCompanyTransfer()
  const [confirmTransfer, setConfirmTransfer] = useState<OwnershipTransferView | null>(null)

  const all = transfers ?? []
  const pending = all.filter((transfer) => transfer.status === "PENDING")
  const history = all.filter((transfer) => transfer.status !== "PENDING")

  const handleAccept = () => {
    if (!confirmTransfer) return
    const transfer = confirmTransfer

    acceptMutation.mutate(
      { id: transfer.id },
      {
        onSuccess: () => {
          toast.success(t("account.transfers.messages.acceptSuccess", { company: transfer.companyName }))
          setConfirmTransfer(null)
          // The sidebar's own company switcher reads `authClient.useSession()` directly
          // (`use-companies.ts`) — a react-query cache invalidation alone would never reach it.
          refetchSession()
        },
        onError: (error) => {
          setConfirmTransfer(null)
          const code =
            error instanceof ApiError ? (error.body as { code?: string } | undefined)?.code : undefined
          if (code === LEGAL_ACCEPTANCE_REQUIRED_CODE) {
            toast.info(t("account.transfers.messages.legalAcceptanceRequired"))
            navigate("/legal/accept")
            return
          }
          toast.error(error instanceof ApiError ? error.message : t("account.transfers.messages.acceptError"))
        },
      },
    )
  }

  return (
    <div className="grid gap-6">
      <SettingsSection
        title={t("account.transfers.pending.title")}
        description={t("account.transfers.pending.description")}
        dataCy="account-transfers-pending-card"
      >
        {isPending ? (
          <SettingsListSkeleton rows={2} dataCy="account-transfers-loading" />
        ) : pending.length === 0 ? (
          <EmptyState
            icon={Building2}
            title={t("account.transfers.pending.empty.title")}
            description={t("account.transfers.pending.empty.description")}
            size="sm"
            data-cy="account-transfers-empty"
          />
        ) : (
          <SettingsList dataCy="account-transfers-pending-list">
            {pending.map((transfer) => (
              <SettingsListRow
                key={transfer.id}
                dataCy={`account-transfer-row-${transfer.id}`}
                leading={<SettingsIconDisc icon={Building2} tone="warning" />}
                badge={<Badge variant="warning">{t("account.transfers.status.pending")}</Badge>}
                title={transfer.companyName}
                meta={
                  <>
                    {t("account.transfers.list.from", { name: transfer.fromName, email: transfer.fromEmail })}
                    {" · "}
                    {t("account.transfers.list.expiresAt")}:{" "}
                    <span className="font-mono tabular-nums">{formatDate(transfer.expiresAt)}</span>
                  </>
                }
                primary={
                  <Button
                    onClick={() => setConfirmTransfer(transfer)}
                    dataCy={`account-transfer-accept-${transfer.id}`}
                  >
                    <CheckCircle2 />
                    {t("account.transfers.list.accept")}
                  </Button>
                }
              />
            ))}
          </SettingsList>
        )}
      </SettingsSection>

      {history.length > 0 && (
        <SettingsSection
          title={
            <>
              <History className="size-4" aria-hidden="true" />
              {t("account.transfers.history.title")}
            </>
          }
          dataCy="account-transfers-history-card"
        >
          <SettingsList dataCy="account-transfers-history-list">
            {history.map((transfer) => (
              <SettingsListRow
                key={transfer.id}
                dataCy={`account-transfer-history-${transfer.id}`}
                leading={<SettingsIconDisc icon={History} />}
                badge={
                  <Badge variant={statusBadgeVariant(transfer.status)}>
                    {t(`account.transfers.status.${transfer.status.toLowerCase()}`)}
                  </Badge>
                }
                title={transfer.companyName}
                meta={
                  <>
                    {t("account.transfers.list.from", { name: transfer.fromName, email: transfer.fromEmail })}
                    {" · "}
                    {t("account.transfers.list.createdAt")}:{" "}
                    <span className="font-mono tabular-nums">{formatDate(transfer.createdAt)}</span>
                  </>
                }
              />
            ))}
          </SettingsList>
        </SettingsSection>
      )}

      <ConfirmationDialog
        open={!!confirmTransfer}
        onOpenChange={(open) => !open && setConfirmTransfer(null)}
        title={t("account.transfers.confirm.title")}
        description={t("account.transfers.confirm.description", {
          company: confirmTransfer?.companyName ?? "",
        })}
        confirmLabel={t("account.transfers.confirm.confirm")}
        cancelLabel={t("account.transfers.confirm.cancel")}
        onConfirm={handleAccept}
        loading={acceptMutation.isPending}
        dataCy="account-transfer-confirm"
      />
    </div>
  )
}
