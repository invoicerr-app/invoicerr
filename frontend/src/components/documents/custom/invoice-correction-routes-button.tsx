import { Scale } from "lucide-react"
import { useState } from "react"
import { useNavigate } from "react-router"
import { useTranslation } from "react-i18next"

import {
  type DocumentCustomSlotProps,
  registerDocumentCustomComponent,
} from "@/components/documents/custom-slots"
import type { CorrectionRouteView, DocumentInstance } from "@/components/documents/types"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { useCorrectionRoutes } from "@/hooks/queries"
import { ApiError } from "@/hooks/use-api-query"
import { cn } from "@/lib/utils"

/**
 * TODO_CORRECTION.md C2 — "Corriger" on an ISSUED invoice (sent/send_failed; a draft has nothing to
 * correct, and the backend's own gate 4 would 409 anyway — see correction-routes.spec.ts) opens a
 * dialog rendering THIS INVOICE'S OWN SELLER COUNTRY's correction routes, exactly as C1's
 * `GET .../correction-routes` hands them back. Same custom-slot mechanism, same file location
 * (custom/) as `invoice-preview-button.tsx` right next to it — this is the SECOND "invoice" ×
 * "list-row-extra" registration (see custom-slots.ts's own header on why that used to be impossible,
 * a real bug this task found and fixed).
 *
 * The dialog never invents a legal fact: `status` and `label` are rendered EXACTLY as the API sends
 * them — `label` in particular is the country file's own legal citation (or, for `unverified`, its
 * honest resolution note), shown VERBATIM, never re-summarized (see CorrectionRouteRow below). Only
 * the STATUS badge, the route's own display name, and every button/heading around them are UI chrome
 * translated through `t()` — the same "backend's own words vs. this app's own chrome" split
 * `DocumentAuthorityEvent.statusText`/`ActionResult.message` already hold elsewhere in this module.
 *
 * `required`/`allowed` routes are CHOOSABLE (a country's own law permits attempting them);
 * `forbidden`/`unverified` never are, whatever `implemented` might say for that routeId elsewhere —
 * "unverified" is "nobody has settled this", not "permitted" (see `isChoosable` below). Choosing a
 * choosable route that is also `implemented` (today: only INTERNAL_CREDIT_NOTE) navigates to the
 * REAL credit-note creation screen, PRE-LINKED to this invoice (`invoice: instance.id` handed through
 * router `state.initialData` — the exact same generic seed `DocumentUpsertDialog.initialData` already
 * serves the received-invoice upload flow, see [typeId].tsx's own consumption of it); T4-d's own
 * `lockedFromReference` then locks the currency the moment that id resolves, with NO further wiring
 * needed here. Choosing a choosable-but-NOT-implemented route (every other route, for every country,
 * today) never pretends to run anything — it shows the honest "declared by the law, not implemented
 * here" panel below, the NAMED refusal TODO_CORRECTION.md C2 requires instead of a stub that fakes it.
 */

const INTERNAL_CREDIT_NOTE_ROUTE_ID = "INTERNAL_CREDIT_NOTE"

/** An invoice has something to correct once it has actually been ISSUED — "sent"/"send_failed" are
 *  the two post-issuance statuses this module's own descriptor uses (see invoice.descriptor.ts); a
 *  "draft" or a "sending" invoice never even offers the button, rather than offering it and letting
 *  the backend's own gate-4 409 ("still draft") explain why nothing happened. */
function isIssued(status: string): boolean {
  return status === "sent" || status === "send_failed"
}

/** Whether the seller's own country PERMITS attempting this route at all — `required`/`allowed`
 *  only. `unverified` is deliberately NOT choosable: "nobody has settled this for this country" is
 *  not the same fact as "this country allows it" (TODO_CORRECTION.md C2's own wording: "« non établi »
 *  n'est pas « permis »"), and `forbidden` obviously never is either. This is INDEPENDENT of
 *  `implemented` — a required route with no real mechanism behind it is still choosable (it leads to
 *  the honest "not implemented" panel), a forbidden route is never choosable even for the one routeId
 *  this repo does know how to execute. */
function isChoosable(route: CorrectionRouteView): boolean {
  return route.status === "required" || route.status === "allowed"
}

const STATUS_BADGE_CLASS: Record<CorrectionRouteView["status"], string> = {
  required: "border-transparent bg-primary text-primary-foreground",
  allowed: "border-transparent bg-secondary text-secondary-foreground",
  forbidden: "border-transparent bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300",
  unverified: "text-muted-foreground",
}

interface CorrectionRouteRowProps {
  route: CorrectionRouteView
  onChoose: (route: CorrectionRouteView) => void
}

/** One route, one row: its display name and status (both UI chrome, translated), its legal `label`
 *  VERBATIM, and either a real "choose" button or a disabled one carrying its own blocked reason —
 *  the exact same dual rendering (a `tooltip` AND a plain, always-visible paragraph) document-list.
 *  tsx's own `DocumentRowActions` already uses for `policyBlockedReason`, for the identical reason
 *  spelled out there: a disabled `<button>`'s `disabled:pointer-events-none` means a mouse hover
 *  never reveals a tooltip-only reason at all. */
function CorrectionRouteRow({ route, onChoose }: CorrectionRouteRowProps) {
  const { t } = useTranslation()
  const choosable = isChoosable(route)
  const blockedReason =
    route.status === "forbidden"
      ? t("documents.form.actionBlockedByPolicy", { reason: route.label })
      : route.status === "unverified"
        ? t("documents.correction.unverifiedReason", { note: route.label })
        : undefined

  return (
    <div
      className={cn("space-y-2 rounded-md border p-3", route.status === "required" && "border-primary")}
      data-cy={`document-correction-route-${route.routeId}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">
          {t(`documents.correction.routes.${route.routeId}`, route.routeId)}
        </span>
        <Badge
          variant={choosable ? undefined : "outline"}
          className={STATUS_BADGE_CLASS[route.status]}
          data-cy={`document-correction-route-${route.routeId}-status`}
        >
          {t(`documents.correction.status.${route.status}`, route.status)}
        </Badge>
      </div>

      {/* The legal citation (or, for `unverified`, the resolution note) — the API's own words,
          rendered as-is, never rewritten. Always shown, whatever the status: a FORBIDDEN route's own
          citation is exactly what explains why (see `blockedReason` above, which wraps this same
          text for the disabled button's reason line below), never hidden once a route is refused. */}
      <p
        className="text-xs text-muted-foreground"
        data-cy={`document-correction-route-${route.routeId}-label`}
      >
        {route.label}
      </p>

      <Button
        type="button"
        size="sm"
        variant={route.status === "required" ? "default" : "outline"}
        disabled={!choosable}
        tooltip={blockedReason}
        onClick={() => onChoose(route)}
        dataCy={`document-correction-route-${route.routeId}-button`}
      >
        {t("documents.correction.chooseRoute")}
      </Button>

      {blockedReason && (
        <p
          className="text-xs text-muted-foreground"
          data-cy={`document-correction-route-${route.routeId}-reason`}
        >
          {blockedReason}
        </p>
      )}
    </div>
  )
}

type DialogView = { kind: "routes" } | { kind: "not-implemented"; route: CorrectionRouteView }

interface CorrectionRoutesDialogBodyProps {
  instance: DocumentInstance
  onClose: () => void
}

function CorrectionRoutesDialogBody({ instance, onClose }: CorrectionRoutesDialogBodyProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data, isLoading, error } = useCorrectionRoutes("invoice", instance.id)
  const [view, setView] = useState<DialogView>({ kind: "routes" })

  const handleChoose = (route: CorrectionRouteView) => {
    if (route.routeId === INTERNAL_CREDIT_NOTE_ROUTE_ID && route.implemented) {
      // THE real mechanism, pre-linked — never a new one built for this screen. `state.initialData`
      // is the SAME generic seed `DocumentUpsertDialog` already accepts for a brand-new record (see
      // that component's own header — the received-invoice upload flow is the other user of it);
      // [typeId].tsx reads it off `useLocation().state` the moment the credit-note page mounts and
      // opens the create dialog with it already applied. Setting only `invoice` is enough: T4-d's
      // own `lockedFromReference` on the credit note's `currency` field watches that sibling field
      // and locks itself the instant it resolves — no currency value needs to be guessed here.
      onClose()
      navigate("/documents/credit-note", { state: { initialData: { invoice: instance.id } } })
      return
    }
    // Declared by the country's own law (required/allowed) but not one this repo wires to a real
    // mechanism today — the NAMED, honest refusal TODO_CORRECTION.md C2 requires, never a button that
    // quietly does nothing or pretends to create something.
    setView({ kind: "not-implemented", route })
  }

  if (isLoading) {
    return (
      <div className="space-y-2" data-cy="document-correction-loading">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    )
  }

  if (error) {
    // The backend's OWN named refusal (a 404 with no correction-routes file for this seller country,
    // or the unresolved-country variant — see correction-routes.ts's own header) shown VERBATIM: a
    // pays sans fichier gets exactly what the API said, never a blank dialog and never a paraphrase.
    return (
      <Alert variant="destructive" data-cy="document-correction-error">
        <AlertTitle>{t("documents.correction.errorTitle")}</AlertTitle>
        <AlertDescription data-cy="document-correction-error-message">
          {error instanceof ApiError ? error.message : t("documents.correction.genericError")}
        </AlertDescription>
      </Alert>
    )
  }

  if (!data) return null // Unreachable in practice — react-query only clears loading with data or error.

  if (view.kind === "not-implemented") {
    return (
      <div className="space-y-4" data-cy="document-correction-not-implemented">
        <Alert data-cy="document-correction-not-implemented-alert">
          <AlertTitle>{t("documents.correction.notImplemented.title")}</AlertTitle>
          <AlertDescription>
            {t("documents.correction.notImplemented.body", {
              route: t(`documents.correction.routes.${view.route.routeId}`, view.route.routeId),
              countryCode: data.countryCode,
            })}
          </AlertDescription>
        </Alert>
        <Button
          type="button"
          variant="outline"
          onClick={() => setView({ kind: "routes" })}
          dataCy="document-correction-back-to-routes"
        >
          {t("documents.correction.notImplemented.back")}
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* The P3-U02 limitation — the API's own words, discreet but never hidden: this is the
          SELLER-only answer, and the seller's own law is not always the whole story once a buyer in
          a different country is involved. */}
      <p className="text-xs text-muted-foreground" data-cy="document-correction-limitation">
        {data.limitation}
      </p>
      <div className="space-y-3" data-cy="document-correction-routes-list">
        {data.routes.map((route) => (
          <CorrectionRouteRow key={route.routeId} route={route} onChoose={handleChoose} />
        ))}
      </div>
    </div>
  )
}

function InvoiceCorrectionRoutesButton({ instance }: DocumentCustomSlotProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  if (!instance) return null // Unreachable in practice — "list-row-extra" always renders per-row.
  if (!isIssued(instance.status)) return null

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        tooltip={t("documents.correction.button")}
        onClick={(event) => {
          event.stopPropagation()
          setOpen(true)
        }}
        dataCy={`document-correction-button-${instance.id}`}
      >
        <Scale className="h-4 w-4" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto" data-cy="document-correction-dialog">
          <DialogHeader>
            <DialogTitle>
              {t("documents.correction.dialogTitle", {
                number: instance.displayNumber ?? instance.id,
              })}
            </DialogTitle>
          </DialogHeader>

          {/* Mounted only while open, like invoice-preview-button.tsx's own dialog content — a
              closed dialog fetches nothing. */}
          {open && <CorrectionRoutesDialogBody instance={instance} onClose={() => setOpen(false)} />}
        </DialogContent>
      </Dialog>
    </>
  )
}

registerDocumentCustomComponent("invoice", "list-row-extra", InvoiceCorrectionRoutesButton)

export { InvoiceCorrectionRoutesButton }
