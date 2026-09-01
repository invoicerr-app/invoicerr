// One scope per resource:action pair a company-scoped API key (or the MCP server built on top of
// it, see backend/src/modules/mcp/) may be granted. Deliberately coarse — no per-tool granularity
// beyond resource:action. A plain string array rather than a Postgres enum so adding a new scope
// later is a pure app-code change, no migration.
//
// "quotes"/"invoices"/"credit-notes"/"expenses"/"received-invoices" are the five DOCUMENT TYPES the
// document engine registers today (documents-core.module.ts's buildDocumentTypeRegistry) — their
// scope NAMES are not a coincidence: the MCP tool layer (mcp/tools/scope-mapping.ts) computes the
// scope a given `typeId` needs by pluralising it ("quote" -> "quotes:read", "credit-note" ->
// "credit-notes:write", ...) rather than hand-mapping each one, so this array is the ONLY place a
// new document type's own MCP access has to be declared — never a second, drifting list. "clients"
// and "articles" are real business ENTITIES the MCP tools read/write directly (list_clients,
// create_client, list_articles), not document types resolved through DocumentTypeRegistry — kept
// distinct from the five above for exactly that reason (see scope-mapping.ts's own header).
export const API_KEY_SCOPES = [
  'quotes:write',
  'invoices:write',
  'clients:write',
  'articles:write',
  'articles:read',
  'quotes:read',
  'invoices:read',
  'clients:read',
  // Root TODO item 23 ("serveur MCP") — the document engine grew two more shipped types
  // (credit-note, expense, received-invoice) since the scopes above were first declared; the MCP
  // module's generic, per-descriptor tools (list_documents/get_document/run_document_action) reach
  // every registered type, not just the original four, so every type needs its own read/write pair
  // here or `scopeForDocumentType` (mcp/tools/scope-mapping.ts) has nothing to grant for it.
  'credit-notes:write',
  'credit-notes:read',
  'expenses:write',
  'expenses:read',
  'received-invoices:write',
  'received-invoices:read',
] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export function isApiKeyScope(value: string): value is ApiKeyScope {
  return (API_KEY_SCOPES as readonly string[]).includes(value);
}
