import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { authenticatedFetch, useGet } from "@/hooks/use-fetch"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { RefreshCwIcon, TrashIcon } from "lucide-react"
import type { CompanyMember, CompanyRole } from "@/types"
import { authClient } from "@/lib/auth"
import { toast } from "sonner"
import { useCompanies } from "@/hooks/queries"
import { useTranslation } from "react-i18next"

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
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>{t("settings.members.title")}</CardTitle>
            <CardDescription>{t("settings.members.description")}</CardDescription>
          </div>
          <Button variant="outline" size="icon" onClick={() => mutate()} disabled={loading}>
            <RefreshCwIcon className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : !members || members.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">{t("settings.members.empty")}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("settings.members.list.name")}</TableHead>
                  <TableHead>{t("settings.members.list.email")}</TableHead>
                  <TableHead>{t("settings.members.list.role")}</TableHead>
                  <TableHead className="text-right">{t("settings.members.list.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((member) => {
                  const isSelf = member.userId === currentUserId
                  return (
                    <TableRow key={member.userId}>
                      <TableCell>
                        {member.firstname} {member.lastname}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{member.email}</TableCell>
                      <TableCell>
                        {isOwner && !isSelf ? (
                          <Select
                            value={member.role}
                            onValueChange={(value) => changeMemberRole(member.userId, value as CompanyRole)}
                          >
                            <SelectTrigger className="w-32">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="MEMBER">{t("settings.invitations.roles.member")}</SelectItem>
                              <SelectItem value="ADMIN">{t("settings.invitations.roles.admin")}</SelectItem>
                              <SelectItem value="OWNER">{t("settings.invitations.roles.owner")}</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : (
                          <Badge variant="outline">{member.role}</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {!isSelf && (isOwner || activeRole === "ADMIN") && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive"
                            onClick={() => removeMember(member.userId)}
                          >
                            <TrashIcon className="h-4 w-4" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
