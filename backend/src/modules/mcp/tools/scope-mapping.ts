/**
 * The scope story for the GENERIC MCP tools (`list_document_types`, `list_documents`,
 * `get_document`, `run_document_action`, `get_document_pdf_link`) — one tool per OPERATION,
 * spanning every document type, unlike the repère's one-tool-per-type model (`create_quote`,
 * `create_invoice`, ..., git tag `avant-refonte-documents`). A single fixed `ApiKeyScope` per tool
 * (still exactly right for `list_clients`/`create_client`/`list_articles`, real business entities a
 * tool reads/writes directly) cannot express this: WHICH document type a call touches only arrives
 * as a call argument (`typeId`), never something registration time can know. So the check is split
 * in two:
 *
 *  1. REGISTRATION time (tools/list visibility, `ToolDescriptor.isRegistered`) — coarse: is there
 *     ANY document-domain scope granted at all? A key holding only `clients:read` never even sees
 *     `run_document_action` in its tool list — but a key holding only `quotes:read` DOES see it (it
 *     is a generic tool, registered once for every type), even though calling it with
 *     `typeId: "invoice"` is still refused at step 2 below. This mirrors the repère's own "fails
 *     fast at planning time" intent as closely as a multi-type tool can: a key with NO document
 *     access at all never learns these tools exist.
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
 */
import { API_KEY_SCOPES, ApiKeyScope, isApiKeyScope } from '@/modules/api-keys/scopes';
import { hasScope } from '@/utils/scope-check';

/** Real business entities the MCP tools read/write DIRECTLY (list_clients, create_client,
 *  list_articles) — never resolved through DocumentTypeRegistry, so never part of the "any document
 *  scope" predicates below. */
const ENTITY_SCOPES: readonly ApiKeyScope[] = [
  'clients:read',
  'clients:write',
  'articles:read',
  'articles:write',
];

export const DOCUMENT_READ_SCOPES: ApiKeyScope[] = API_KEY_SCOPES.filter(
  (scope) => scope.endsWith(':read') && !ENTITY_SCOPES.includes(scope),
);

export const DOCUMENT_WRITE_SCOPES: ApiKeyScope[] = API_KEY_SCOPES.filter(
  (scope) => scope.endsWith(':write') && !ENTITY_SCOPES.includes(scope),
);

/**
 * The scope a `typeId` needs for `mode` — `${typeId}s:${mode}` ("quote" -> "quotes:read",
 * "received-invoice" -> "received-invoices:write", ...). `undefined` (never a thrown error) when
 * that computed name isn't a real, declared `ApiKeyScope` — see this file's own header for why that
 * is the correct, fail-closed answer rather than a crash.
 */
export function scopeForDocumentType(typeId: string, mode: 'read' | 'write'): ApiKeyScope | undefined {
  const candidate = `${typeId}s:${mode}`;
  return isApiKeyScope(candidate) ? candidate : undefined;
}

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
