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
    payments: {
        list: (page: number) => ["payments", "list", page] as const,
        listsAll: () => ["payments", "list"] as const,
        search: (query: string) => ["payments", "search", query] as const,
    },
    paymentMethods: {
        list: () => ["paymentMethods", "list"] as const,
    },
    dashboard: {
        summary: () => ["dashboard", "summary"] as const,
    },
    company: {
        info: () => ["company", "info"] as const,
    },
} as const
