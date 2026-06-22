export const queryKeys = {
    clients: {
        list: (page: number) => ["clients", "list", page] as const,
        listsAll: () => ["clients", "list"] as const,
        search: (query: string) => ["clients", "search", query] as const,
    },
    invoices: {
        list: (page: number) => ["invoices", "list", page] as const,
        listsAll: () => ["invoices", "list"] as const,
        search: (query: string) => ["invoices", "search", query] as const,
    },
    recurringInvoices: {
        list: (page: number) => ["recurringInvoices", "list", page] as const,
        listsAll: () => ["recurringInvoices", "list"] as const,
    },
    quotes: {
        list: (page: number) => ["quotes", "list", page] as const,
        listsAll: () => ["quotes", "list"] as const,
        search: (query: string) => ["quotes", "search", query] as const,
    },
    receipts: {
        list: (page: number) => ["receipts", "list", page] as const,
        listsAll: () => ["receipts", "list"] as const,
        search: (query: string) => ["receipts", "search", query] as const,
    },
    paymentMethods: {
        list: () => ["paymentMethods", "list"] as const,
    },
    articles: {
        list: () => ["articles", "list"] as const,
    },
    dashboard: {
        summary: () => ["dashboard", "summary"] as const,
    },
    company: {
        info: () => ["company", "info"] as const,
    },
} as const
