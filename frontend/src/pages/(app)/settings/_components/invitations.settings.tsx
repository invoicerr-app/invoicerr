import { CopyIcon, PlusIcon, RefreshCwIcon, TicketIcon, TrashIcon } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { authenticatedFetch, useGet, usePost } from "@/hooks/use-fetch"
import type { CompanyRole } from "@/types"
import {
  SettingsFormFooter,
  SettingsIconDisc,
  SettingsList,
  SettingsListRow,
  SettingsListSkeleton,
  SettingsPage,
  SettingsRowMenu,
  SettingsSection,
} from "./settings-section"

type InvitationCode = {
  id: string
  code: string
  role: CompanyRole
  createdAt: string
  expiresAt: string | null
  usedAt: string | null
  usedBy: {
    id: string
    email: string
    firstname: string
    lastname: string
  }
}

export default function InvitationsSettings() {
  const { t } = useTranslation()
  const [expiresInDays, setExpiresInDays] = useState<number | "">("")
  const [role, setRole] = useState<CompanyRole>("MEMBER")

  const { data: invitations, loading, mutate } = useGet<InvitationCode[]>("/api/invitations")
  const { trigger: createInvitationApi, loading: creating } = usePost<InvitationCode>("/api/invitations")

  const createInvitation = async () => {
    const result = await createInvitationApi({ expiresInDays: expiresInDays || undefined, role })
    if (result) {
      toast.success(t("settings.invitations.messages.createSuccess"))
      setExpiresInDays("")
      mutate()

      // Copy code to clipboard
      await navigator.clipboard.writeText(result.code)
      toast.info(t("settings.invitations.messages.codeCopied"))
    } else {
      toast.error(t("settings.invitations.messages.createError"))
    }
  }

  const deleteInvitation = async (id: string) => {
    try {
      const backendUrl = import.meta.env.VITE_BACKEND_URL || ""
      const response = await authenticatedFetch(`${backendUrl}/api/invitations/${id}`, {
        method: "DELETE",
      })
      if (response.ok) {
        toast.success(t("settings.invitations.messages.deleteSuccess"))
        mutate()
      } else {
        toast.error(t("settings.invitations.messages.deleteError"))
      }
    } catch (error) {
      console.error("Error deleting invitation:", error)
      toast.error(t("settings.invitations.messages.deleteError"))
    }
  }

  const copyCode = async (code: string) => {
    await navigator.clipboard.writeText(code)
    toast.success(t("settings.invitations.messages.codeCopied"))
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    })
  }

  const getStatus = (invitation: InvitationCode) => {
    if (invitation.usedAt) {
      return { label: t("settings.invitations.status.used"), variant: "secondary" as const }
    }
    if (invitation.expiresAt && new Date(invitation.expiresAt) < new Date()) {
      return { label: t("settings.invitations.status.expired"), variant: "destructive" as const }
    }
    return { label: t("settings.invitations.status.active"), variant: "success" as const }
  }

  return (
    <SettingsPage title={t("settings.invitations.title")} description={t("settings.invitations.description")}>
      <SettingsSection
        title={t("settings.invitations.create.title")}
        description={t("settings.invitations.create.description")}
        contentClassName="grid gap-4 sm:grid-cols-2"
        footer={
          <SettingsFormFooter>
            <Button onClick={createInvitation} loading={creating} data-cy="invitations-create-button">
              <PlusIcon />
              {creating ? t("settings.invitations.create.creating") : t("settings.invitations.create.button")}
            </Button>
          </SettingsFormFooter>
        }
      >
        <div className="grid gap-1.5">
          <Label htmlFor="expiresInDays">{t("settings.invitations.create.expiresIn")}</Label>
          <Input
            id="expiresInDays"
            type="number"
            min="1"
            placeholder={t("settings.invitations.create.expiresPlaceholder")}
            value={expiresInDays}
            onChange={(e) => setExpiresInDays(e.target.value ? Number.parseInt(e.target.value, 10) : "")}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="role">{t("settings.invitations.create.role")}</Label>
          <Select value={role} onValueChange={(value) => setRole(value as CompanyRole)}>
            <SelectTrigger id="role" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="MEMBER">{t("settings.invitations.roles.member")}</SelectItem>
              <SelectItem value="ADMIN">{t("settings.invitations.roles.admin")}</SelectItem>
              <SelectItem value="OWNER">{t("settings.invitations.roles.owner")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </SettingsSection>

      <SettingsSection
        title={t("settings.invitations.list.title")}
        description={t("settings.invitations.list.description")}
        aside={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("settings.common.refresh")}
            tooltip={t("settings.common.refresh")}
            onClick={() => mutate()}
            disabled={loading}
            data-cy="invitations-refresh"
          >
            <RefreshCwIcon className={loading ? "animate-spin" : undefined} />
          </Button>
        }
      >
        {loading ? (
          <SettingsListSkeleton rows={3} />
        ) : !invitations || invitations.length === 0 ? (
          <EmptyState
            icon={TicketIcon}
            size="sm"
            title={t("settings.invitations.list.empty")}
            data-cy="invitations-empty"
          />
        ) : (
          <SettingsList dataCy="invitations-list">
            {invitations.map((invitation) => {
              const status = getStatus(invitation)
              return (
                <SettingsListRow
                  key={invitation.id}
                  dataCy={`invitation-row-${invitation.id}`}
                  leading={<SettingsIconDisc icon={TicketIcon} />}
                  badge={
                    <>
                      <Badge variant="outline">{invitation.role}</Badge>
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </>
                  }
                  title={<span className="font-mono tabular-nums">{invitation.code.substring(0, 8)}…</span>}
                  meta={
                    <>
                      {t("settings.invitations.list.createdAt")}:{" "}
                      <span className="font-mono tabular-nums">{formatDate(invitation.createdAt)}</span>
                      {" · "}
                      {t("settings.invitations.list.expiresAt")}:{" "}
                      <span className="font-mono tabular-nums">
                        {invitation.expiresAt
                          ? formatDate(invitation.expiresAt)
                          : t("settings.invitations.list.noExpiry")}
                      </span>
                      {invitation.usedBy && (
                        <>
                          {" · "}
                          {t("settings.invitations.list.usedBy")}: {invitation.usedBy.firstname}{" "}
                          {invitation.usedBy.lastname}
                        </>
                      )}
                    </>
                  }
                  primary={
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label={t("settings.common.copy")}
                      tooltip={t("settings.common.copy")}
                      onClick={() => copyCode(invitation.code)}
                      data-cy={`invitation-copy-${invitation.id}`}
                    >
                      <CopyIcon />
                    </Button>
                  }
                  menu={
                    !invitation.usedAt ? (
                      <SettingsRowMenu
                        dataCy={`invitation-menu-${invitation.id}`}
                        items={[
                          {
                            label: t("settings.common.delete"),
                            icon: TrashIcon,
                            onSelect: () => deleteInvitation(invitation.id),
                            destructive: true,
                            dataCy: `invitation-delete-${invitation.id}`,
                          },
                        ]}
                      />
                    ) : undefined
                  }
                />
              )
            })}
          </SettingsList>
        )}
      </SettingsSection>
    </SettingsPage>
  )
}
