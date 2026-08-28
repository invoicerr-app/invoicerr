/**
 * The three compliance panels that had no interface.
 *
 * Every one is driven ENTIRELY by the `available-actions` payload, which the backend derives from
 * the country profile. There is deliberately not a single country name, ISO code or `if (FR)` in
 * this file: the architecture's rule is that no business code names a country, and a screen that
 * hardcoded "show the credit-note panel in France" would be the first place that rule broke.
 *
 * What that buys, concretely: France shows a ten-year retention notice and three obligation layers
 * because its profile says so, Germany shows different ones from the same code path, and adding a
 * country adds no branch here.
 */
import type { AvailableActions } from "@/hooks/queries/use-available-actions"
import { AlertTriangle, Archive, CalendarClock, Info } from "lucide-react"
import { useTranslation } from "react-i18next"

function Panel({
  tone,
  icon,
  title,
  dataCy,
  children,
}: {
  tone: "amber" | "slate" | "blue"
  icon: React.ReactNode
  title: string
  dataCy: string
  children: React.ReactNode
}) {
  const tones = {
    amber: "bg-amber-50 border-amber-200 text-amber-900",
    slate: "bg-muted/50 border-border text-foreground",
    blue: "bg-blue-50 border-blue-200 text-blue-900",
  }
  return (
    <div className={`rounded-lg border p-3 text-sm ${tones[tone]}`} data-cy={dataCy}>
      <div className="mb-1 flex items-center gap-2 font-medium">
        {icon}
        {title}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  )
}

/**
 * A — what the country allows, and under what conditions.
 *
 * Replaces a single hardcoded English sentence chosen by an `else if`, which meant a document
 * subject to both a deadline AND an authority acknowledgement advertised only one of them, and no
 * locale could translate either. Conditions are plural here because reality is.
 */
export function CancellationPolicyPanel({ actions }: { actions: AvailableActions }) {
  const { t, i18n } = useTranslation()
  const { policy, conditions, allowed } = actions.cancellation

  // Nothing to say when cancellation is simply available with no strings attached.
  if (allowed && conditions.length === 0) return null
  if (conditions.length === 0) return null

  const deadline = policy.expiresAt
    ? new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(policy.expiresAt),
      )
    : null
  const expired = policy.expiresAt ? new Date(policy.expiresAt).getTime() < Date.now() : false

  return (
    <Panel
      tone="amber"
      icon={<AlertTriangle className="h-4 w-4" />}
      title={t("invoices.view.compliance.cancellation.title")}
      dataCy="cancellation-policy"
    >
      <ul className="list-disc space-y-1 pl-4">
        {conditions.map((key) => (
          <li key={key} data-cy={`cancellation-condition-${key}`}>
            {key === "window"
              ? deadline
                ? t(
                    expired
                      ? "invoices.view.compliance.cancellation.windowExpired"
                      : "invoices.view.compliance.cancellation.windowUntil",
                    { deadline },
                  )
                : t("invoices.view.compliance.cancellation.windowHours", {
                    hours: policy.windowHours,
                  })
              : t(`invoices.view.compliance.cancellation.${key}`)}
          </li>
        ))}
      </ul>
    </Panel>
  )
}

/**
 * B — how long this document must be kept, and where.
 *
 * There were zero occurrences of `retention` or `archival` anywhere in the frontend while the
 * French profile obliged ten years. A user deleting a document had no way to know it was not
 * theirs to delete.
 */
export function ArchivalPanel({ actions }: { actions: AvailableActions }) {
  const { t } = useTranslation()
  if (!actions.archival) return null
  const { retentionYears, residency, integrity } = actions.archival

  return (
    <Panel
      tone="slate"
      icon={<Archive className="h-4 w-4" />}
      title={t("invoices.view.compliance.archival.title")}
      dataCy="archival-notice"
    >
      <p data-cy="archival-retention">
        {t("invoices.view.compliance.archival.retention", { years: retentionYears })}
      </p>
      {residency && (
        <p data-cy="archival-residency">
          {t("invoices.view.compliance.archival.residency", { country: residency })}
        </p>
      )}
      {integrity !== "NONE" && (
        <p data-cy="archival-integrity">{t(`invoices.view.compliance.archival.integrity.${integrity}`)}</p>
      )}
    </Panel>
  )
}

/**
 * C — the duties that attach to this operation, by layer.
 *
 * Issuing, receiving and archiving have different triggers and different clocks; the product used
 * to show one thing where there are three. An `openQuestion` is rendered as such rather than
 * silently omitted: a duty whose timing nobody sourced is information, and hiding it would let a
 * reader assume there is no deadline.
 */
export function ObligationLayersPanel({ actions }: { actions: AvailableActions }) {
  const { t } = useTranslation()
  if (!actions.obligations.length) return null

  return (
    <Panel
      tone="blue"
      icon={<CalendarClock className="h-4 w-4" />}
      title={t("invoices.view.compliance.obligations.title")}
      dataCy="obligation-layers"
    >
      <ul className="space-y-1">
        {actions.obligations.map((o) => (
          <li key={`${o.layer}-${o.kind}`} data-cy={`obligation-${o.layer}`}>
            <span className="font-medium">{t(`invoices.view.compliance.obligations.layer.${o.layer}`)}</span>
            {" — "}
            {o.deadline ? (
              t("invoices.view.compliance.obligations.deadline", {
                value: t(`invoices.view.compliance.obligations.unit.${o.deadline.unit}`, {
                  count: o.deadline.value,
                }),
              })
            ) : (
              <span className="inline-flex items-center gap-1 italic" data-cy={`obligation-open-${o.layer}`}>
                <Info className="h-3 w-3" />
                {t("invoices.view.compliance.obligations.notSourced")}
              </span>
            )}
            {o.blocking && (
              <span className="ml-1 font-medium" data-cy={`obligation-blocking-${o.layer}`}>
                {t("invoices.view.compliance.obligations.blocking")}
              </span>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  )
}
