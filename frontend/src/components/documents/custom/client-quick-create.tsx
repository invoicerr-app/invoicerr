import { useQueryClient } from "@tanstack/react-query"

import {
  registerReferenceCreateComponent,
  type ReferenceCreateComponentProps,
} from "@/components/documents/reference-create-registry"
import { ClientUpsert } from "@/pages/(app)/clients/_components/client-upsert"
import type { Client } from "@/types"

/**
 * Wires the "client" reference entity to the real client wizard (client-upsert.tsx) — reused as-is,
 * never re-implemented: `onCreate` is the exact prop the standalone /clients screen already passes
 * it, so a client made from a document's own picker is saved through the identical mutation,
 * validation and country-identifiers wiring as one made from /clients.
 *
 * Also invalidates the reference-search cache (`["document-references", "client", ...]`) — a
 * SEPARATE react-query namespace from `queryKeys.clients.listsAll()`, which is all `ClientUpsert`'s
 * own `onSubmit` already invalidates (the /clients LIST screen's own query). Without this, a client
 * created from a document's picker resolves fine the first time (a fresh query key the create just
 * populated), but a re-opened picker searching the same term again would still answer from its own
 * stale "no such client yet" cache.
 */
function ClientQuickCreate({ open, onOpenChange, onCreated }: ReferenceCreateComponentProps) {
  const queryClient = useQueryClient()
  return (
    <ClientUpsert
      open={open}
      onOpenChange={onOpenChange}
      onCreate={(client: Client) => {
        queryClient.invalidateQueries({ queryKey: ["document-references", "client"] })
        onCreated(client.id)
      }}
    />
  )
}

registerReferenceCreateComponent("client", ClientQuickCreate)

export { ClientQuickCreate }
