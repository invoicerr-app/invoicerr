import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import type { Client } from "@/types"

/** The badges a client row and its "view" header share: state (Active/Inactive, a coloured tone),
 *  then categories (type, public body, supplier) in neutral tones — colour means "state" here and
 *  nowhere else. Its own file (rather than living on `index.tsx`, which also renders it) so the
 *  "view" dialog can import it without a circular dependency between the two. */
export function ClientBadges({ client }: { client: Client }) {
  const { t } = useTranslation()
  // The email is optional now — a client without one falls back to its own id, the same rule
  // index.tsx's own row keys use, so these selectors never render the literal string "undefined".
  const rowKey = client.contactEmail?.trim() || client.id
  return (
    <>
      <Badge
        variant={client.isActive ? "success" : "secondary"}
        data-cy={client.isActive ? `client-status-active-${rowKey}` : `client-status-inactive-${rowKey}`}
      >
        {client.isActive ? t("clients.list.status.active") : t("clients.list.status.inactive")}
      </Badge>
      <Badge variant="outline">
        {client.type === "INDIVIDUAL"
          ? t("clients.upsert.fields.type.individual")
          : t("clients.upsert.fields.type.company")}
      </Badge>
      {client.kind === "GOVERNMENT" && <Badge variant="outline">{t("clients.list.kind.government")}</Badge>}
      {/* The "supplier" role, visible without opening the record. */}
      {client.isSupplier && (
        <Badge variant="secondary" data-cy={`client-role-supplier-${rowKey}`}>
          {t("clients.list.role.supplier")}
        </Badge>
      )}
    </>
  )
}
