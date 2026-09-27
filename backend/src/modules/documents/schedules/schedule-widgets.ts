/**
 * The dashboard's "upcoming recurrences" widget — added ALONGSIDE every
 * existing dashboard widget (contributions/), never in place of them: this is not a per-DOCUMENT-TYPE
 * contribution (the `ContributionRegistry` mechanism, contributions/contribution-registry.ts, is
 * keyed by (typeId, location) precisely because a document TYPE decides what it shows about ITSELF),
 * it is a property of the SCHEDULING mechanism, which spans every type at once — so it is wired
 * directly into `DocumentsService.collectWidgets` (documents.service.ts) rather than through that
 * registry. Pure and framework-agnostic, same "easy to unit test without a database" split every
 * other widget-producing function in this codebase already holds.
 */
import { ShortListWidget } from '../contributions/widgets';
import { DashboardPeriod } from '../dto/dashboard-query.dto';
import { DocumentScheduleRecord } from './schedule.persistence';

const UPCOMING_LIMIT = 5;

/**
 * The N soonest ENABLED schedules, across every document type, each item's `primary` naming its own
 * type (via `typeLabels`, resolved from the live `DocumentTypeRegistry` — never hard-coded here) —
 * the closest this flat widget vocabulary (ShortListWidget has no grouping structure) gets to
 * "grouped by type" without inventing a fifth widget kind for a single contribution. Always returned
 * (even with zero items — the same "an empty pending-invoices list still shows the card" convention
 * `invoice-contributions.ts`'s own `pendingWidget` already holds), so the feature stays discoverable
 * on a company that has never created one yet.
 *
 * `typeLabels` falls back to the bare `typeId` for a schedule whose type is no longer registered on
 * this build (the same "degrade honestly, never crash" posture `document-list.tsx`'s own
 * `resolveListFields` holds for a dangling `listItem` key).
 *
 * `period` (issue #418) is deliberately NEVER applied to `nextRunAt` - this list names FUTURE
 * occurrences, while the dashboard's period answers "which already-issued documents fall in this
 * range", a question about the past. Restricting `nextRunAt` to a period built that way would make
 * the ordinary presets actively misleading: "Last 30 days", or "This month" once the month is mostly
 * over, would silently empty a list of schedules that are very much still active, simply because none
 * of them happens to fire again before the range's own end. Rather than invent a DIFFERENT,
 * schedule-specific meaning for "period" nobody asked for, this widget stays unscoped and says so in
 * its own `warnings` whenever a period is set - visible, not silent, the same discipline
 * `WidgetBase.warnings`'s own header holds everywhere else in this module.
 */
export function buildUpcomingSchedulesWidget(
  schedules: DocumentScheduleRecord[],
  typeLabels: Record<string, string>,
  period?: DashboardPeriod,
): ShortListWidget {
  const upcoming = schedules
    .filter((schedule) => schedule.enabled)
    .sort((a, b) => a.nextRunAt.getTime() - b.nextRunAt.getTime())
    .slice(0, UPCOMING_LIMIT);

  return {
    id: 'document-schedule:upcoming',
    kind: 'shortList',
    label: 'Upcoming recurrences',
    ...(period
      ? {
          warnings: [
            'The selected period does not apply to this list: it always shows the next scheduled ' +
              'runs, regardless of the active period.',
          ],
        }
      : {}),
    items: upcoming.map((schedule) => ({
      id: schedule.id,
      primary: `${typeLabels[schedule.typeId] ?? schedule.typeId} — ${schedule.actionId}`,
      secondary: schedule.nextRunAt.toISOString().slice(0, 10),
    })),
  };
}
