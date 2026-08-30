import { useTranslation } from "react-i18next"

import { WidgetGrid } from "@/components/widgets/widget-grid"
import { useStatisticsWidgets } from "@/hooks/queries"
import { usePageHeader } from "@/hooks/use-page-header"

/**
 * Statistics — the SAME widget-contribution mechanism as the dashboard (see dashboard.tsx and the
 * backend's contributions/collect-widgets.ts), pulled from a SECOND location ("statistics") a
 * document type may separately opt into. "Dashboard c'est certaines informations visuelles [...],
 * statistics c'est tout ultra détaillé" — the vocabulary is identical (a widget is a widget); only
 * WHICH widgets a type chooses to contribute here differs (e.g. invoice-contributions.ts's detailed
 * "All invoices" table, absent from the dashboard).
 */
export default function Statistics() {
  const { t } = useTranslation()
  const { data: widgets = [], isLoading } = useStatisticsWidgets()

  usePageHeader(t("sidebar.navigation.stats"))

  return (
    <div className="flex flex-col gap-4 p-6">
      <WidgetGrid widgets={widgets} isLoading={isLoading} emptyDataCy="statistics-empty" />
    </div>
  )
}
