import { useTranslation } from "react-i18next"

import { StatusMark } from "@/components/ui/status-mark"
import type { Client } from "@/types"

/** What a client row and its "view" header show next to the name: the state as a status mark,
 *  then the categories (type, public body, supplier) as quiet words. */
export function ClientBadges({ client }: { client: Client }) {
  const { t } = useTranslation()
  // The email is optional: a client without one falls back to its own id, the same rule
  // index.tsx's own row keys use, so these selectors never render the literal string "undefined".
  const rowKey = client.contactEmail?.trim() || client.id
  const category = "text-[13px] text-muted-foreground"
  return (
    <>
      <StatusMark
        tone={client.isActive ? "success" : "neutral"}
        glyph={client.isActive ? "disc" : "open"}
        data-cy={client.isActive ? `client-status-active-${rowKey}` : `client-status-inactive-${rowKey}`}
      >
        {client.isActive ? t("clients.list.status.active") : t("clients.list.status.inactive")}
      </StatusMark>
      <span className={category}>
        {client.type === "INDIVIDUAL"
          ? t("clients.upsert.fields.type.individual")
          : t("clients.upsert.fields.type.company")}
      </span>
      {client.kind === "GOVERNMENT" && <span className={category}>{t("clients.list.kind.government")}</span>}
      {client.isSupplier && (
        <span className={category} data-cy={`client-role-supplier-${rowKey}`}>
          {t("clients.list.role.supplier")}
        </span>
      )}
    </>
  )
}
