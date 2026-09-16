import { RefreshCwIcon, TrashIcon, Users } from "lucide-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useCompanies } from "@/hooks/queries"
import { authenticatedFetch, useGet } from "@/hooks/use-fetch"
import { authClient } from "@/lib/auth"
import type { CompanyMember, CompanyRole } from "@/types"
import {
  SettingsIconDisc,
  SettingsList,
  SettingsListRow,
  SettingsListSkeleton,
  SettingsPage,
  SettingsRowMenu,
} from "./settings-section"

export default function MembersSettings() {
  const { t } = useTranslation()
  const { data: session } = authClient.useSession()
  const { activeRole } = useCompanies()

  const { data: members, loading, mutate } = useGet<CompanyMember[]>("/api/companies/members")

  const currentUserId = (session as { user?: { id?: string } } | null)?.user?.id
  const isOwner = activeRole === "OWNER"

  const changeMemberRole = async (userId: string, role: CompanyRole) => {
    try {
      const backendUrl = import.meta.env.VITE_BACKEND_URL || ""
      const res = await authenticatedFetch(`${backendUrl}/api/companies/members/${userId}`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      })
      if (!res.ok) throw new Error("failed")
      toast.success(t("settings.members.messages.roleUpdateSuccess"))
      mutate()
    } catch {
      toast.error(t("settings.members.messages.roleUpdateError"))
    }
  }

  const removeMember = async (userId: string) => {
    try {
      const backendUrl = import.meta.env.VITE_BACKEND_URL || ""
      const res = await authenticatedFetch(`${backendUrl}/api/companies/members/${userId}`, {
        method: "DELETE",
      })
      if (!res.ok) throw new Error("failed")
      toast.success(t("settings.members.messages.removeSuccess"))
      mutate()
    } catch {
      toast.error(t("settings.members.messages.removeError"))
    }
  }

  return (
    <SettingsPage
      title={t("settings.members.title")}
      description={t("settings.members.description")}
      actions={
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t("settings.common.refresh")}
          tooltip={t("settings.common.refresh")}
          onClick={() => mutate()}
          disabled={loading}
          data-cy="members-refresh"
        >
          <RefreshCwIcon className={loading ? "animate-spin" : undefined} />
        </Button>
      }
    >
      {loading ? (
        <SettingsListSkeleton rows={3} />
      ) : !members || members.length === 0 ? (
        <EmptyState icon={Users} size="sm" title={t("settings.members.empty")} data-cy="members-empty" />
      ) : (
        <SettingsList dataCy="members-list">
          {members.map((member) => {
            const isSelf = member.userId === currentUserId
            const canEditRole = isOwner && !isSelf
            const canRemove = !isSelf && (isOwner || activeRole === "ADMIN")
            return (
              <SettingsListRow
                key={member.userId}
                dataCy={`member-row-${member.userId}`}
                leading={<SettingsIconDisc icon={Users} />}
                title={`${member.firstname} ${member.lastname}`}
                meta={member.email}
                badge={!canEditRole ? <Badge variant="outline">{member.role}</Badge> : undefined}
                primary={
                  canEditRole ? (
                    <Select
                      value={member.role}
                      onValueChange={(value) => changeMemberRole(member.userId, value as CompanyRole)}
                    >
                      <SelectTrigger className="w-32" data-cy={`member-role-select-${member.userId}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="MEMBER">{t("settings.invitations.roles.member")}</SelectItem>
                        <SelectItem value="ADMIN">{t("settings.invitations.roles.admin")}</SelectItem>
                        <SelectItem value="OWNER">{t("settings.invitations.roles.owner")}</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : undefined
                }
                menu={
                  canRemove ? (
                    <SettingsRowMenu
                      dataCy={`member-menu-${member.userId}`}
                      items={[
                        {
                          label: t("settings.common.remove"),
                          icon: TrashIcon,
                          onSelect: () => removeMember(member.userId),
                          destructive: true,
                          dataCy: `member-remove-${member.userId}`,
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
    </SettingsPage>
  )
}
