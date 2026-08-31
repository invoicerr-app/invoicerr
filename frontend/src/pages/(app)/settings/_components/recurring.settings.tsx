import { Trash2 } from "lucide-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import {
  useDeleteDocumentSchedule,
  useDocumentSchedules,
  useDocumentTypesList,
  useReferenceResolve,
  useSetDocumentScheduleEnabled,
} from "@/hooks/queries"
import type { DocumentSchedule } from "@/components/documents/types"

/** The source document's own human-facing label — via the SAME generic 'reference' resolve endpoint
 *  a `DocumentFieldDescriptor` of kind 'reference' already uses (document reference providers are
 *  registered under their own typeId as the entity name — see the backend's
 *  documents-core.module.ts's `buildEntityReferenceRegistry`). Falls back to the raw, truncated id
 *  for a type with no registered reference provider (nothing shipped declares "duplicate" outside
 *  quote/invoice today, both of which DO have one) — degrading honestly, never a crash. */
function ScheduleSourceLabel({ typeId, sourceDocumentId }: { typeId: string; sourceDocumentId: string }) {
  const { data } = useReferenceResolve(typeId, sourceDocumentId)
  return <span>{data?.label ?? `${sourceDocumentId.slice(0, 8)}…`}</span>
}

function formatDate(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString()
}

interface ScheduleRowProps {
  schedule: DocumentSchedule
  typeLabel: string
}

function ScheduleRow({ schedule, typeLabel }: ScheduleRowProps) {
  const { t } = useTranslation()
  const setEnabled = useSetDocumentScheduleEnabled()
  const deleteSchedule = useDeleteDocumentSchedule()

  const handleToggle = async (enabled: boolean) => {
    try {
      await setEnabled.mutateAsync({ id: schedule.id, enabled })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("documents.schedules.list.toggleError"))
    }
  }

  const handleDelete = async () => {
    try {
      await deleteSchedule.mutateAsync({ id: schedule.id })
      toast.success(t("documents.schedules.list.deleted"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("documents.schedules.list.deleteError"))
    }
  }

  return (
    <div
      className="flex flex-col gap-2 border-b py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
      data-cy={`document-schedule-row-${schedule.id}`}
    >
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-foreground">{typeLabel}</span>
          <span className="text-muted-foreground">·</span>
          <ScheduleSourceLabel typeId={schedule.typeId} sourceDocumentId={schedule.sourceDocumentId} />
          <Badge variant="outline">
            {t(`documents.schedules.cadence.${schedule.cadence}`, schedule.cadence)}
          </Badge>
          {!schedule.enabled && (
            <Badge variant="secondary" data-cy={`document-schedule-disabled-${schedule.id}`}>
              {t("documents.schedules.list.disabled")}
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap gap-x-4 text-sm text-muted-foreground">
          <span data-cy={`document-schedule-next-run-${schedule.id}`}>
            {t("documents.schedules.list.nextRunAt", { date: formatDate(schedule.nextRunAt) })}
          </span>
          <span data-cy={`document-schedule-last-run-${schedule.id}`}>
            {t("documents.schedules.list.lastRunAt", { date: formatDate(schedule.lastRunAt) })}
          </span>
        </div>
        {schedule.lastError && (
          <p className="text-sm text-destructive" data-cy={`document-schedule-last-error-${schedule.id}`}>
            {t("documents.schedules.list.lastError", { message: schedule.lastError })}
          </p>
        )}
      </div>

      <div className="flex items-center gap-3">
        <Switch
          checked={schedule.enabled}
          onCheckedChange={handleToggle}
          disabled={setEnabled.isPending}
          data-cy={`document-schedule-toggle-${schedule.id}`}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          loading={deleteSchedule.isPending}
          onClick={handleDelete}
          dataCy={`document-schedule-delete-${schedule.id}`}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

/**
 * The recurrences screen — root TODO item 5, point 5: every `DocumentSchedule` for the active
 * company, across EVERY document type, generic on purpose (a plugin's own type that registers
 * "duplicate" gets a row here for free the moment it creates a schedule, with no change to this
 * file). Lives as its own settings tab (see -[tab].tsx) rather than a per-type page section: a
 * recurrence already names its own type inline (the badge/label below), so one screen for all of
 * them reads better than one buried inside each type's own page.
 */
export default function RecurringSettings() {
  const { t } = useTranslation()
  const { data: schedules, isLoading } = useDocumentSchedules()
  const { data: types = [] } = useDocumentTypesList()
  const typeLabels = Object.fromEntries(types.map((type) => [type.id, type.label]))

  return (
    <Card data-cy="document-schedules-card">
      <CardHeader>
        <CardTitle>{t("settings.tabs.recurring")}</CardTitle>
        <CardDescription>{t("documents.schedules.list.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : !schedules || schedules.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-cy="document-schedules-empty">
            {t("documents.schedules.list.empty")}
          </p>
        ) : (
          <div data-cy="document-schedules-list">
            {schedules.map((schedule) => (
              <ScheduleRow
                key={schedule.id}
                schedule={schedule}
                typeLabel={typeLabels[schedule.typeId] ?? schedule.typeId}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
