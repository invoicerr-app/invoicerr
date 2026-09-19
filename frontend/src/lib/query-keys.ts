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
  invoices: {
    list: (page: number) => ["invoices", "list", page] as const,
    listsAll: () => ["invoices", "list"] as const,
    search: (query: string) => ["invoices", "search", query] as const,
    table: (filters: { clientId?: string; year?: number; month?: number; sort: "asc" | "desc" }) =>
      ["invoices", "table", filters] as const,
  },
  recurringInvoices: {
    list: (page: number) => ["recurringInvoices", "list", page] as const,
    listsAll: () => ["recurringInvoices", "list"] as const,
  },
  quotes: {
    list: (page: number) => ["quotes", "list", page] as const,
    listsAll: () => ["quotes", "list"] as const,
    search: (query: string) => ["quotes", "search", query] as const,
    table: (filters: { clientId?: string; year?: number; month?: number; sort: "asc" | "desc" }) =>
      ["quotes", "table", filters] as const,
  },
  payments: {
    list: (page: number) => ["payments", "list", page] as const,
    listsAll: () => ["payments", "list"] as const,
    search: (query: string) => ["payments", "search", query] as const,
    table: (filters: {
      invoiceId?: string
      clientId?: string
      year?: number
      month?: number
      sort: "asc" | "desc"
    }) => ["payments", "table", filters] as const,
  },
  paymentMethods: {
    list: () => ["paymentMethods", "list"] as const,
  },
  articles: {
    list: () => ["articles", "list"] as const,
  },
  projects: {
    list: (filters: { clientId?: string; includeArchived?: boolean } = {}) =>
      ["projects", "list", filters] as const,
  },
  timeEntries: {
    list: (filters: { projectId?: string; clientId?: string; unbilledOnly?: boolean } = {}) =>
      ["timeEntries", "list", filters] as const,
  },
  bankStatements: {
    list: () => ["bankStatements", "list"] as const,
    lines: (statementId: string) => ["bankStatements", "lines", statementId] as const,
  },
  dashboard: {
    summary: () => ["dashboard", "summary"] as const,
  },
  company: {
    info: () => ["company", "info"] as const,
  },
  billing: {
    status: () => ["billing", "status"] as const,
    email: () => ["billing", "email"] as const,
    seats: () => ["billing", "seats"] as const,
  },
  declarations: {
    list: (page: number, status?: string) => ["declarations", "list", page, status] as const,
  },
  legal: {
    documents: () => ["legal", "documents"] as const,
    status: () => ["legal", "status"] as const,
  },
  instance: {
    preflight: () => ["instance", "preflight"] as const,
  },
  companyTransfer: {
    current: () => ["companyTransfer", "current"] as const,
    received: () => ["companyTransfer", "received"] as const,
  },
} as const
