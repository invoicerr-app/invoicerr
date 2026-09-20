/**
 * The scope story for the GENERIC MCP tools (`list_document_types`, `list_documents`,
 * `get_document`, `run_document_action`, `get_document_pdf_link`) — one tool per OPERATION,
 * spanning every document type, unlike the removed compliance engine's one-tool-per-type model (`create_quote`,
 * `create_invoice`, ..., git tag `avant-refonte-documents`). A single fixed `ApiKeyScope` per tool
 * (still exactly right for `list_clients`/`create_client`/`list_articles`, real business entities a
 * tool reads/writes directly) cannot express this: WHICH document type a call touches only arrives
 * as a call argument (`typeId`), never something registration time can know. So the check is split
 * in two:
 *
 *  1. REGISTRATION time (tools/list visibility, `ToolDescriptor.isRegistered`) — coarse, and coarse
 *     in the direction the tool needs: the read tools ask for any document-domain scope at all,
 *     while `run_document_action` asks specifically for a WRITE one, since no read-only key has a
 *     use for it whatever type it names. So a key holding only `clients:read` sees none of these
 *     tools, a key holding only `quotes:read` sees the read ones but not `run_document_action`, and
 *     a key holding `quotes:write` sees all of them — including for types it cannot touch, because
 *     WHICH type a call names only arrives as an argument, so registration cannot filter on it.
 *     Calling one with a `typeId` the key has no scope for is still refused at step 2 below. This
 *     mirrors the removed compliance engine's own "fails fast at planning time" intent as closely as
 *     a multi-type tool can: a key with no document access at all never learns these tools exist.
 *  2. CALL time, inside each tool's own handler — precise: does the key hold the scope for THIS
 *     SPECIFIC `typeId`? `scopeForDocumentType` computes it by pluralising the id, exactly the way
 *     every shipped descriptor's own id already reads ("quote" -> "quotes:read", "credit-note" ->
 *     "credit-notes:write", ...) — no per-type branch to maintain here, the same "a document type is
 *     DATA" discipline the rest of this engine holds everywhere else. A `typeId` whose computed
 *     scope name isn't one `API_KEY_SCOPES` actually declares (a plugin-registered type nobody gave
 *     an MCP scope to) fails CLOSED: `scopeForDocumentType` returns `undefined`, meaning no key —
 *     however broadly scoped — can ever be granted access to it through this tool. This is a
 *     DELIBERATE, MCP-specific gate that runs BEFORE `DocumentsService.runAction`'s own four gates
 *     (country/status/implementation/validation) — it is never a substitute for them, and never
 *     touches them: a scope-denied call here never reaches `runAction`/`ShareLinksService` at all.
 *
 * `DOCUMENT_READ_SCOPES`/`DOCUMENT_WRITE_SCOPES` are derived from `API_KEY_SCOPES` itself, minus the
 * two ENTITY scopes (`clients`/`articles`) — so adding a sixth document type's own scopes to
 * `api-keys/scopes.ts` is the ONLY change ever needed to extend both the registration gate and the
 * per-call gate to it; nothing in this file is ever edited by hand for a new document type.
 *
 * `DOCUMENT_READ_SCOPES`/`DOCUMENT_WRITE_SCOPES`/`scopeForDocumentType` themselves now live in
 * `utils/scope-check.ts` (re-exported below, unchanged, for every existing import site in this
 * module) — `documents.controller.ts`'s own `@RequiresDocumentTypeScope` needs the EXACT same
 * per-typeId computation this MCP layer pioneered, and a REST controller has no business importing
 * from the `mcp/` module to get it (the dependency belongs the other way around).
 */
import { ApiKeyScope } from '@/modules/api-keys/scopes';
import { hasScope, scopeForDocumentType } from '@/utils/scope-check';

export { DOCUMENT_READ_SCOPES, DOCUMENT_WRITE_SCOPES, scopeForDocumentType } from '@/utils/scope-check';

/** Registration-time predicate: at least one of `candidates` is granted. `scopes === null` (session
 *  auth) is never scope-restricted — see hasScope's own header; unreachable in practice since only
 *  API keys ever call the MCP endpoint, kept here only for consistency with hasScope itself. */
export function hasAnyScope(candidates: readonly ApiKeyScope[], scopes: string[] | null): boolean {
  return candidates.some((scope) => hasScope({ scopes }, scope));
}

/** Call-time predicate for a READ operation on `typeId` — granted by EITHER the read OR the write
 *  scope for that type (a key allowed to WRITE a document type can certainly read it back). Used by
 *  `list_documents`/`get_document`/`get_document_pdf_link`. */
export function canReadDocumentType(scopes: string[] | null, typeId: string): boolean {
  const read = scopeForDocumentType(typeId, 'read');
  const write = scopeForDocumentType(typeId, 'write');
  return (!!read && hasScope({ scopes }, read)) || (!!write && hasScope({ scopes }, write));
}

/** Call-time predicate for a WRITE operation on `typeId` — used by `run_document_action`, which
 *  always mutates or creates (there is no read-only action registered anywhere today). */
export function canWriteDocumentType(scopes: string[] | null, typeId: string): boolean {
  const write = scopeForDocumentType(typeId, 'write');
  return !!write && hasScope({ scopes }, write);
}
