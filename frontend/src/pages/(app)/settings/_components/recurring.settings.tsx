import { Repeat, Trash2 } from "lucide-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { Switch } from "@/components/ui/switch"
import {
  useDeleteDocumentSchedule,
  useDocumentSchedules,
  useDocumentTypesList,
  useReferenceResolve,
  useSetDocumentScheduleEnabled,
} from "@/hooks/queries"
import type { DocumentSchedule } from "@/components/documents/types"

import {
  SettingsList,
  SettingsListRow,
  SettingsListSkeleton,
  SettingsPage,
  SettingsRowMenu,
  SettingsSection,
} from "./settings-section"

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
    <SettingsListRow
      dataCy={`document-schedule-row-${schedule.id}`}
      badge={
        <>
          <Badge variant="outline">
            {t(`documents.schedules.cadence.${schedule.cadence}`, schedule.cadence)}
          </Badge>
          {!schedule.enabled && (
            <Badge variant="secondary" data-cy={`document-schedule-disabled-${schedule.id}`}>
              {t("documents.schedules.list.disabled")}
            </Badge>
          )}
        </>
      }
      title={
        <span className="flex flex-wrap items-center gap-x-2">
          <span>{typeLabel}</span>
          <span className="text-muted-foreground">·</span>
          <ScheduleSourceLabel typeId={schedule.typeId} sourceDocumentId={schedule.sourceDocumentId} />
        </span>
      }
      meta={
        <span className="flex flex-wrap gap-x-4">
          <span className="font-mono tabular-nums" data-cy={`document-schedule-next-run-${schedule.id}`}>
            {t("documents.schedules.list.nextRunAt", { date: formatDate(schedule.nextRunAt) })}
          </span>
          <span className="font-mono tabular-nums" data-cy={`document-schedule-last-run-${schedule.id}`}>
            {t("documents.schedules.list.lastRunAt", { date: formatDate(schedule.lastRunAt) })}
          </span>
        </span>
      }
      menu={
        <>
          <Switch
            checked={schedule.enabled}
            onCheckedChange={handleToggle}
            disabled={setEnabled.isPending}
            aria-label={t(`documents.schedules.cadence.${schedule.cadence}`, schedule.cadence)}
            data-cy={`document-schedule-toggle-${schedule.id}`}
          />
          <SettingsRowMenu
            items={[
              {
                label: t("settings.common.delete"),
                icon: Trash2,
                onSelect: handleDelete,
                disabled: deleteSchedule.isPending,
                destructive: true,
                dataCy: `document-schedule-delete-${schedule.id}`,
              },
            ]}
          />
        </>
      }
    >
      {schedule.lastError && (
        <p className="text-sm text-destructive" data-cy={`document-schedule-last-error-${schedule.id}`}>
          {t("documents.schedules.list.lastError", { message: schedule.lastError })}
        </p>
      )}
    </SettingsListRow>
  )
}

/**
 * The recurrences screen: every `DocumentSchedule` for the active
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
    <SettingsPage
      title={t("settings.recurring.title", "Recurrences")}
      description={t(
        "settings.recurring.description",
        "Every recurring schedule that automatically creates a new document from an existing one, across all document types.",
      )}
      dataCy="document-schedules-section"
    >
      {isLoading ? (
        <SettingsListSkeleton rows={2} />
      ) : !schedules || schedules.length === 0 ? (
        <SettingsSection>
          <EmptyState
            icon={Repeat}
            size="sm"
            title={t("documents.schedules.list.empty")}
            data-cy="document-schedules-empty"
          />
        </SettingsSection>
      ) : (
        <SettingsList dataCy="document-schedules-list">
          {schedules.map((schedule) => (
            <ScheduleRow
              key={schedule.id}
              schedule={schedule}
              typeLabel={typeLabels[schedule.typeId] ?? schedule.typeId}
            />
          ))}
        </SettingsList>
      )}
    </SettingsPage>
  )
}
