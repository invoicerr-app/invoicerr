import { useTranslation } from "react-i18next"

import { WidgetGrid } from "@/components/widgets/widget-grid"
import { useDashboardWidgets } from "@/hooks/queries"
import { usePageHeader } from "@/hooks/use-page-header"

/**
 * The dashboard, rebuilt on the widget-contribution mechanism (see the backend's
 * contributions/collect-widgets.ts): every document type that declares a "dashboard" contribution
 * gets to add its own widgets here — "certaines informations visuelles" per the task's own wording —
 * this page never names which type produced which widget, or even how many types there are. The
 * invoice is the first (and, for now, only) real contributor — see
 * backend/src/modules/documents/contributions/invoice-contributions.ts.
 */
export default function Dashboard() {
  const { t } = useTranslation()
  const { data: widgets = [], isLoading } = useDashboardWidgets()

  usePageHeader(t("dashboard.title"))

  return (
    <div className="flex flex-col gap-4 p-6">
      <WidgetGrid widgets={widgets} isLoading={isLoading} emptyDataCy="dashboard-empty" />
    </div>
  )
}
