import { useEffect } from "react"
import { useQueryClient } from "@tanstack/react-query"

import { useSse } from "./use-fetch"

/**
 * Mirrors the backend's own `DocumentEventMessage` (queue/document-events.ts) — deliberately THIN,
 * never the resulting status/verdict itself: a nudge to re-fetch, never a second source of truth.
 * See that backend file's own header for the full reasoning this hook leans on unmodified.
 */
export type DocumentEventKind = "sending" | "sent" | "send_failed" | "authority-event"

export interface DocumentEventMessage {
  documentId: string
  typeId: string
  kind: DocumentEventKind
}

/**
 * TODO_PRODUIT.md T1 / PLAN-V2 R8 — the frontend half of the worker→API SSE bridge. Mounted ONCE, for
 * the whole authenticated app ((app)/_layout.tsx's own AuthenticatedLayout — see that file), so a
 * status change reaches every open screen without a manual reload, regardless of which document
 * list/detail/conformity panel happens to be mounted at that moment. Consumes the backend's
 * `@Sse('events')` route (documents.controller.ts) through the pre-existing `useSse` hook
 * (use-fetch.ts, already `withCredentials: true`) — see that route's own header for the worker→API
 * Redis pub/sub bridge behind it, and for why a tenant can never receive another tenant's own event.
 *
 * On receipt, invalidates at the TYPE level (`["documents", typeId]`), never the single document:
 * TanStack Query's own default `exact: false` matching means this ALSO covers every key NESTED under
 * it — the instance list itself, the detail (`["documents", typeId, id]`), the settlement, the
 * archives, and the conformity panel's own authority-events
 * (`["documents", typeId, id, "authority-events"]`) — see hooks/queries/use-document-types.ts for
 * every one of those query keys. Slightly broader than the single document the event actually names
 * (every OTHER document of that type currently mounted also re-fetches), but the same coarse-grained
 * choice `useRunDocumentAction`'s own `invalidateKeys: [["documents"]]` already makes for every action
 * mutation in this codebase — see that hook's own comment, same file.
 *
 * Deliberately does not accumulate a message log, does not expose `data`/`loading`/`error` to its
 * caller, and does not itself decide what changed: the ONLY effect is "go re-fetch" — the ordinary
 * REST GET behind each invalidated query remains the single authoritative source for the state a
 * screen actually renders, exactly the discipline `queue/document-events.ts`'s own header states for
 * the wire message itself. A missed or duplicate nudge costs nothing: `invalidateQueries` for a key
 * nothing has ever fetched is a no-op, and invalidating twice for the same fact just re-fetches twice.
 *
 * `useDocumentInstances`'s own `refetchInterval` (`use-document-types.ts`) — and
 * `useDocumentAuthorityEvents`'s own — stay in place as a SLOW fallback (see each hook's own comment
 * for the exact interval and why): SSE can fall silent (a misbehaving proxy, a dropped connection
 * before the browser's own auto-reconnect kicks in) without this codebase's own discipline of "the
 * screen must still catch up eventually" ever being violated.
 */
export function useDocumentEventsSse(): void {
  const queryClient = useQueryClient()
  const { data } = useSse<DocumentEventMessage>("/api/documents/events")

  useEffect(() => {
    // `data` starts `null` (no message received yet) and stays whatever the LAST message was —
    // `useSse`'s own `onmessage` never fires for a heartbeat (a NAMED SSE event, `type: "heartbeat"`;
    // `EventSource.onmessage` only fires for the unnamed default type — see `useSse`'s own
    // implementation and documents.controller.ts's own `streamEvents` header), so `data` is either
    // absent or a genuine DocumentEventMessage, never a heartbeat mistaken for one.
    if (!data) return
    queryClient.invalidateQueries({ queryKey: ["documents", data.typeId] })
  }, [data, queryClient])
}
