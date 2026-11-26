import { useTranslation } from "react-i18next"

import { SelectItem } from "@/components/ui/select"

/** The company roles a member can be given, in the order the member list and the invitation form
 *  both offer them: one list, so a new role cannot reach one picker and not the other. */
export function CompanyRoleSelectItems() {
  const { t } = useTranslation()
  return (
    <>
      <SelectItem value="MEMBER">{t("settings.invitations.roles.member")}</SelectItem>
      <SelectItem value="ADMIN">{t("settings.invitations.roles.admin")}</SelectItem>
      <SelectItem value="OWNER">{t("settings.invitations.roles.owner")}</SelectItem>
    </>
  )
}
