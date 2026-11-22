export const queryKeys = {
  clients: {
    list: (page: number) => ["clients", "list", page] as const,
    listsAll: () => ["clients", "list"] as const,
    search: (query: string) => ["clients", "search", query] as const,
    statement: (clientId: string) => ["clients", "statement", clientId] as const,
    duplicates: (email?: string, name?: string, country?: string, excludeId?: string) =>
      ["clients", "duplicates", email ?? "", name ?? "", country ?? "", excludeId ?? ""] as const,
    byId: (clientId: string) => ["clients", "byId", clientId] as const,
  },
  paymentMethods: {
    list: () => ["paymentMethods", "list"] as const,
    // Issue #416 - one client's own restriction.
    clientRestriction: (clientId: string) => ["paymentMethods", "clientRestriction", clientId] as const,
  },
  articles: {
    list: () => ["articles", "list"] as const,
  },
  projects: {
    list: (filters: { clientId?: string; includeArchived?: boolean } = {}) =>
      ["projects", "list", filters] as const,
    listsAll: () => ["projects", "list"] as const,
  },
  timeEntries: {
    list: (filters: { projectId?: string; clientId?: string; unbilledOnly?: boolean } = {}) =>
      ["timeEntries", "list", filters] as const,
    listsAll: () => ["timeEntries", "list"] as const,
  },
  // Everything document-instance-related hangs under `["documents"]`: `all()` is the prefix every
  // document action invalidates (use-document-types.ts's `useRunDocumentAction`), `byType` the one a
  // live document event invalidates (use-document-events-sse.ts).
  documents: {
    all: () => ["documents"] as const,
    byType: (typeId: string | undefined) => ["documents", typeId] as const,
    list: <F>(typeId: string | undefined, filters: F) => ["documents", typeId, filters] as const,
    instance: (typeId: string | undefined, id: string | undefined) => ["documents", typeId, id] as const,
    instanceSub: <S extends string>(typeId: string | undefined, id: string | undefined, sub: S) =>
      ["documents", typeId, id, sub] as const,
    transmissionPreview: (typeId: string | undefined, id: string | undefined, actionId: string | undefined) =>
      ["documents", typeId, id, "actions", actionId, "transmission-preview"] as const,
  },
  documentReferences: {
    entity: (entity: string) => ["document-references", entity] as const,
    // Shared by the single- and multi-entity searches so both read the same cache entry.
    search: (entity: string | undefined, query: string) =>
      ["document-references", entity, "search", query] as const,
    byId: (entity: string | undefined, id: string | undefined) =>
      ["document-references", entity, id] as const,
    fields: (entity: string | undefined, id: string | undefined) =>
      ["document-references", entity, id, "fields"] as const,
  },
  bankStatements: {
    list: () => ["bankStatements", "list"] as const,
    lines: (statementId: string) => ["bankStatements", "lines", statementId] as const,
  },
  company: {
    info: () => ["company", "info"] as const,
    // The editable form avoids cached snapshots and other info observers' background refetches.
    settings: () => ["company-settings"] as const,
    paymentTerms: () => ["company", "paymentTerms"] as const,
  },
  billing: {
    all: () => ["billing"] as const,
    status: () => ["billing", "status"] as const,
    seats: () => ["billing", "seats"] as const,
    stripeSubscription: (companyId: string | null) => ["billing", "stripe-subscription", companyId] as const,
  },
  declarations: {
    all: () => ["declarations"] as const,
    list: (page: number, status?: string) => ["declarations", "list", page, status] as const,
  },
  legal: {
    // `lang` folded into the key (not just the URL) so switching a document-language selector reuses
    // react-query's own cache per language instead of refetching a language already seen this session.
    documents: (lang?: string) => ["legal", "documents", lang ?? null] as const,
    status: () => ["legal", "status"] as const,
  },
  registration: {
    status: () => ["registration", "status"] as const,
  },
  errorTracking: {
    consent: () => ["errorTracking", "consent"] as const,
  },
  instance: {
    preflight: () => ["instance", "preflight"] as const,
  },
  companyTransfer: {
    current: () => ["companyTransfer", "current"] as const,
    received: () => ["companyTransfer", "received"] as const,
  },
  version: {
    info: () => ["version", "info"] as const,
  },
} as const
