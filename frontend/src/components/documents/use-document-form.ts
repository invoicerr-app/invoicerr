import { zodResolver } from "@hookform/resolvers/zod"
import { useEffect, useMemo, useState } from "react"
import { useForm } from "react-hook-form"

import { buildZodSchema, defaultValuesFor } from "@/components/documents/schema"
import type { DocumentInstance, DocumentTypeDescriptor } from "@/components/documents/types"
import { isActionAvailable } from "@/components/documents/types"
import { useDocumentActionRunner } from "@/components/documents/use-document-action-runner"
import { useDocumentType, useReferenceFields } from "@/hooks/queries"

/**
 * `data.lineTotalWarnings` — a RESERVED key (never a declared `DocumentFieldDescriptor`), the same
 * convention `received-invoice.descriptor.ts`'s own `fileRef`/`fileName`/`fileMime` already use for
 * bookkeeping the generic field-render never touches. Read here GENERICALLY, by key name only —
 * nothing below names "received-invoice" (the backend's own `received-invoices/
 * line-totals-check.ts` is the only writer today; any future type could reuse the same key
 * and get this same rendering for free, exactly the "a country/type is data" discipline the rest of
 * this module already holds).
 */
export function extractLineTotalWarnings(data: Record<string, unknown> | undefined): string[] {
  const warnings = data?.lineTotalWarnings
  return Array.isArray(warnings) ? warnings.filter((w): w is string => typeof w === "string") : []
}

export interface UseDocumentFormOptions {
  descriptor: DocumentTypeDescriptor
  documentId?: string
  initialData?: Record<string, unknown>
  status?: string
  /** The record's own displayNumber, as known when this form was opened — see types.ts's
   *  `DocumentInstance.displayNumber`. Absent/null for a not-yet-numbered (or never-numbered) record;
   *  re-synced live via `onDocumentUpdate` once an action actually numbers it (e.g. "send"), the same
   *  way `status` already is. */
  displayNumber?: string | null
  /** Fires after an action that actually changed the document — e.g. so a caller can refresh a list
   *  or "follow" the document once it exists (a fresh draft is created on the first save). Not
   *  called for an action whose result carries no document (see ActionResult on the backend). */
  onActionSuccess?: (result: DocumentInstance, actionId: string) => void
}

/**
 * The ENTIRE state of a document form, for ANY document type, with no rendering of its own — the
 * create dialog (document-create-dialog.tsx) and the detail page (document-detail.tsx) both mount
 * this and lay its pieces out differently (one short modal, one two-column page); neither knows
 * anything about the type it is showing. Add a type by writing a descriptor (backend) with fields
 * the field-renderer registry already covers; add an action (native or third-party) with an id, a
 * label, and optionally `params` — this hook never changes either way.
 *
 * Returns the react-hook-form instance (to wrap the screen in `<Form>`), the LIVE descriptor
 * (`effectiveDescriptor`, see below), the record's own current id/status/number as the last action
 * left them, the actions available right now, and the action runner.
 */
export function useDocumentForm({
  descriptor,
  documentId,
  initialData,
  status,
  displayNumber,
  onActionSuccess,
}: UseDocumentFormOptions) {
  const [currentDocumentId, setCurrentDocumentId] = useState(documentId)
  const [currentStatus, setCurrentStatus] = useState(status)
  const [currentDisplayNumber, setCurrentDisplayNumber] = useState(displayNumber ?? null)
  // See extractLineTotalWarnings's own header. Seeded from whatever this
  // instance already carried (a reopened, already-saved record); re-derived below both when
  // `initialData` itself changes AND the moment "receive" runs again (a save recomputes it — see
  // received-invoice-actions.ts's own header), so editing a line and saving reacts immediately,
  // without waiting on a page reload or a second fetch.
  const [lineTotalWarnings, setLineTotalWarnings] = useState(() => extractLineTotalWarnings(initialData))

  // The B2G document-field bridge's OWN screen gap ("the Leitweg field is proven only at
  // the service level, not interactive"): `descriptor` (this hook's own option) was fetched by the
  // PAGE with no client known yet, so a rule's `requiredDocumentFields` (e.g. Germany's Leitweg-ID,
  // `documents.service.ts#applyB2gDocumentFieldHints`) never reaches it. This watches whichever field
  // is THIS type's own single-target 'reference' to "client" (the same key `b2g-routing.ts`'s own
  // header names — "the invoice's own submitted `data.client`") and re-fetches the descriptor WITH
  // that id the moment it changes, so picking a GOVERNMENT client adds the field reactively, and
  // picking a different one removes it again — never a static, page-load-time-only view.
  //
  // `watchedClientId` is plain `useState`, NOT `form.watch` read directly — it (and the descriptor,
  // and the schema built from it) must all be known BEFORE `useForm` below is even called, so the
  // VERY FIRST resolver already validates any B2G-added field; `form.watch` needs `form` to exist
  // first, which is exactly the ordering this avoids. Seeded from `initialData` so an EXISTING
  // government-client document already shows its B2G field(s) on the first paint, not only after the
  // user re-touches the client field.
  const clientFieldKey = descriptor.fields.find(
    (field) => field.kind === "reference" && field.entity === "client" && !field.entities,
  )?.key
  const [watchedClientId, setWatchedClientId] = useState<string | undefined>(() => {
    if (!clientFieldKey) return undefined
    const raw = (initialData as Record<string, unknown> | undefined)?.[clientFieldKey]
    return typeof raw === "string" && raw ? raw : undefined
  })
  const { data: liveDescriptor } = useDocumentType(descriptor.id, watchedClientId)
  // Falls back to the page-provided `descriptor` the instant the client-aware fetch hasn't resolved
  // yet (a fresh id just picked, or none at all) — never a blank form while it's in flight, and this
  // hook's own query-key collapse (see use-document-types.ts) means the "no client yet" case reuses
  // the SAME cache entry `descriptor` itself came from, not a second request.
  const effectiveDescriptor = liveDescriptor ?? descriptor

  // Custom fields ("champs personnalisés") — this company's OWN active custom fields for
  // THIS document type are already part of `effectiveDescriptor.fields`: the backend now merges them
  // in (`documents.service.ts#describeTypeForCompany`, right after the country field overlay — see
  // that method's own header), the exact same "an add operation composed onto the fields the form
  // renders" mechanism a country overlay's own added fields already go through. Nothing to merge
  // here any more — `DocumentField`/`buildZodSchema`/`defaultValuesFor` already iterate every field
  // this descriptor carries, custom ones included, with ZERO kind-specific code of their own.
  const schema = useMemo(() => buildZodSchema(effectiveDescriptor.fields), [effectiveDescriptor])

  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: initialData ?? defaultValuesFor(descriptor.fields),
  })

  // Keeps `watchedClientId` in sync with the LIVE form value of the client field — a plain
  // subscription into local state (see the comment above for why this isn't `form.watch` read
  // directly): every change re-derives `liveDescriptor`/`effectiveDescriptor` above, which is what
  // makes the B2G field(s) appear or disappear the moment the user picks a different client.
  useEffect(() => {
    if (!clientFieldKey) return
    const subscription = form.watch((values, info) => {
      if (info.name !== undefined && info.name !== clientFieldKey) return
      const raw = (values as Record<string, unknown>)[clientFieldKey]
      setWatchedClientId(typeof raw === "string" && raw ? raw : undefined)
    })
    return () => subscription.unsubscribe()
  }, [form, clientFieldKey])

  // The screens key this hook's host by document id (a "new" vs. an existing one are different
  // mounts), so useState above already seeds currentDocumentId/currentStatus correctly. What a fresh
  // mount can't have yet is the record's DATA: the detail page's own fetch resolves after mount, and
  // react-hook-form only applies `defaultValues` once, at mount — this is what re-applies it (and the
  // status that arrives alongside it) once the query actually resolves.
  //
  // This effect ALSO keeps firing for as long as the host stays mounted on the SAME record: the
  // detail page re-derives `status`/`displayNumber` LIVE from the same query the list itself polls
  // while a record is "sending", so once a "send" this form triggered actually settles —
  // "sending" -> "sent" or "send_failed" — `currentStatus` catches up here too, without leaving the
  // page. `initialData`'s own object reference is a SNAPSHOT the host only ever replaces on purpose
  // (after a save, or a discard — see document-detail.tsx's own comment on why a background refetch
  // must never replace it), so `form.reset` never re-fires from a poll alone.
  useEffect(() => {
    if (initialData !== undefined) {
      form.reset(initialData)
    }
    if (status !== undefined) {
      setCurrentStatus(status)
    }
    if (displayNumber !== undefined) {
      setCurrentDisplayNumber(displayNumber ?? null)
    }
    if (initialData !== undefined) {
      setLineTotalWarnings(extractLineTotalWarnings(initialData))
    }
  }, [initialData, status, displayNumber, form])

  // Three-way match (rapprochement à 3 voies) — "pré-remplies depuis le BC": a
  // NARROW, explicitly TYPE-GATED exception, unlike the B2G client-watching block above (which looks
  // for ANY field with `entity === "client"`, never a specific typeId): there is no generic descriptor
  // hint today for "populate this WHOLE array field from a top-level reference field's own sub-array"
  // (unlike `prefillFrom`, which fills ONE row from a picked catalog entity — types.ts's own comment),
  // and inventing one for this single consumer would be exactly the speculative machinery this
  // codebase avoids — see goods-receipt.descriptor.ts's own header. Fires ONLY for a record that has
  // never been saved yet (`!currentDocumentId` — an existing one keeps whatever the user already
  // edited/saved) the first time its own `purchaseOrder` field resolves to an id, and ONLY while
  // `lines` is still empty — never overwrites rows the user has already started typing.
  const isGoodsReceipt = descriptor.id === "goods-receipt"
  const [goodsReceiptPoId, setGoodsReceiptPoId] = useState<string | undefined>(() => {
    if (!isGoodsReceipt) return undefined
    const raw = (initialData as Record<string, unknown> | undefined)?.purchaseOrder
    return typeof raw === "string" && raw ? raw : undefined
  })
  const { data: goodsReceiptPurchaseOrder } = useReferenceFields(
    isGoodsReceipt ? "purchase-order" : undefined,
    goodsReceiptPoId,
  )
  useEffect(() => {
    if (!isGoodsReceipt) return
    const subscription = form.watch((values, info) => {
      if (info.name !== undefined && info.name !== "purchaseOrder") return
      const raw = (values as Record<string, unknown>).purchaseOrder
      setGoodsReceiptPoId(typeof raw === "string" && raw ? raw : undefined)
    })
    return () => subscription.unsubscribe()
  }, [form, isGoodsReceipt])
  // `form.setValue("lines", ..., { shouldDirty: true, shouldValidate: true })` — NOT a second
  // `useFieldArray({ control, name: "lines" }).replace()` here, despite that being RHF's own
  // documented API for a field array already in use elsewhere. Verified live (not just read) after
  // 70-three-way-match.cy.ts's own "records a PARTIAL goods receipt" kept timing out on
  // `document-field-lines-row-0`: react-hook-form 7.80's `useFieldArray`'s own action methods
  // (`replace`/`append`/`remove`/…) update `control._formValues` but do NOT emit on
  // `control._subjects.array` — the ONLY channel a SEPARATE `useFieldArray` instance on the same
  // name (here, `field-renderers/array-field.tsx`'s own, which is what actually RENDERS the rows)
  // subscribes to for cross-instance sync (see node_modules/react-hook-form/dist/index.esm.mjs:
  // `_setFieldArray`'s `shouldUpdateFieldsAndState` gate, and `_subjects.array.next` calls, which
  // exist only in `_setValue` — `form.setValue`'s own internal — and `reset()`). A `replace()` called
  // from THIS component's own, separate `useFieldArray` instance therefore left `array-field.tsx`'s
  // rendered `fields` permanently empty: `form.getValues("lines")` already showed the replaced rows
  // (proving the write itself worked), the SCREEN never did. `form.setValue` on a field-array name
  // routes through `_setValue`, which DOES call `_subjects.array.next(...)` — the renderer catches
  // up immediately, confirmed against the real PO/goods-receipt flow in a browser.
  useEffect(() => {
    if (!isGoodsReceipt || currentDocumentId || !goodsReceiptPurchaseOrder) return
    const currentLines = form.getValues("lines")
    if (Array.isArray(currentLines) && currentLines.length > 0) return
    const poLines = (goodsReceiptPurchaseOrder as Record<string, unknown>).lines
    if (!Array.isArray(poLines) || poLines.length === 0) return
    form.setValue(
      "lines",
      poLines.map((line) => {
        const row = (line ?? {}) as Record<string, unknown>
        return {
          description: typeof row.description === "string" ? row.description : "",
          quantityReceived: typeof row.quantity === "number" ? row.quantity : 0,
        }
      }),
      { shouldDirty: true, shouldValidate: true },
    )
  }, [isGoodsReceipt, currentDocumentId, goodsReceiptPurchaseOrder, form])

  const runner = useDocumentActionRunner({
    typeId: descriptor.id,
    documentId: currentDocumentId,
    getData: () => form.getValues(),
    validate: () => form.trigger(),
    onActionSuccess: (result, actionId) => {
      // See extractLineTotalWarnings's own header — this is why the SAVE round-trip alone (never a
      // client-side recomputation) already reacts: `result.data` is this exact record's own,
      // freshly-persisted `data`, straight off the action's own response.
      setLineTotalWarnings(extractLineTotalWarnings(result.data))
      onActionSuccess?.(result, actionId)
    },
    onDocumentUpdate: (id, nextStatus, _nextNumber, nextDisplayNumber) => {
      setCurrentDocumentId(id)
      setCurrentStatus(nextStatus)
      setCurrentDisplayNumber(nextDisplayNumber ?? null)
    },
  })

  // The STATUS gate (isActionAvailable) is unchanged: an action outside its `availableWhen` for the
  // current status simply never appears here, exactly as before. The COUNTRY POLICY gate is a
  // second, independent concern layered on top: an action that passes the status gate can still
  // carry a `policyBlockedReason` (see types.ts), in which case it stays ON SCREEN — rendered
  // disabled with the reason spelled out — rather than disappearing. A vanished button looks like a
  // missing feature; a disabled one with a reason looks like a rule, which is what it is.
  // "cancel" is EXCLUDED here too, same reasoning as document-list.tsx's own
  // row-level filter: its one entry point is the correction-routes dialog (custom/invoice-correction-
  // routes-button.tsx, with its own irreversibility confirmation), never a second generic button.
  // "download-xml" and "share-link" are excluded for the reason document-list.tsx spells out on its
  // own row cluster: both are declared for the status/policy gates only, and neither is a POST
  // through `runAction` (a plain GET, a REST resource) — the detail page offers them through their
  // own dedicated entries instead (document-detail.tsx).
  const availableActions = descriptor.actions.filter(
    (action) =>
      action.id !== "cancel" &&
      action.id !== "download-xml" &&
      action.id !== "share-link" &&
      isActionAvailable(action, currentStatus),
  )

  // The settlement section (payments, credit notes, balance — document-settlement.tsx): shown for
  // ANY document type once "record-payment" is actually OFFERED for the record's current status —
  // never by naming a type. A brand-new, never-saved record (no `currentDocumentId` yet) has nothing
  // to show here either way: there is no instance to fetch a settlement FOR.
  const showSettlement =
    !!currentDocumentId && availableActions.some((action) => action.id === "record-payment")

  return {
    form,
    effectiveDescriptor,
    currentDocumentId,
    currentStatus,
    currentDisplayNumber,
    lineTotalWarnings,
    availableActions,
    showSettlement,
    runner,
  }
}

export type DocumentFormState = ReturnType<typeof useDocumentForm>
