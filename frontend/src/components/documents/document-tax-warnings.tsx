import { useTranslation } from "react-i18next"

import { ProseHelp } from "@/components/ui/prose-help"
import { formatServerMessages, type ServerMessage } from "@/lib/server-message"
import { useDocumentTaxWarnings } from "@/hooks/queries"

interface DocumentTaxWarningsProps {
  warnings: ServerMessage[]
}

// The caveats change the amounts above, so the status stays visible; their text opens behind the `?`.
export function DocumentTaxWarnings({ warnings }: DocumentTaxWarningsProps) {
  const { t } = useTranslation()

  if (warnings.length === 0) return null

  return (
    <ProseHelp
      tone="warning"
      title={t("documents.totals.taxWarningsTitle")}
      dataCy="document-tax-warnings"
      className="mt-3"
    >
      {formatServerMessages(t, warnings)}
    </ProseHelp>
  )
}

interface DocumentTaxWarningsSectionProps {
  typeId: string
  documentId: string
}

// No skeleton and no error branch: the totals card looks the same until there is something to warn about.
export function DocumentTaxWarningsSection({ typeId, documentId }: DocumentTaxWarningsSectionProps) {
  const { data } = useDocumentTaxWarnings(typeId, documentId)
  return <DocumentTaxWarnings warnings={data?.warnings ?? []} />
}
