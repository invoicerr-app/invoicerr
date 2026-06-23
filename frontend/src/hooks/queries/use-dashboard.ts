import { useApiQuery } from "@/hooks/use-api-query"
import { queryKeys } from "@/lib/query-keys"
import type { Company, Invoice, Quote } from "@/types"

export interface DashboardData {
    company: Company | null
    quotes: {
        total: number
        draft: number
        sent: number
        signed: number
        expired: number
        latests: Quote[]
    }
    invoices: {
        total: number
        unpaid: number
        sent: number
        paid: number
        overdue: number
        latests: Invoice[]
    }
    clients: {
        total: number
    }
    revenue: {
        last6Months: { createdAt: Date; total: number }[]
        currentMonth: number
        previousMonth: number
        monthlyChange: number
        monthlyChangePercent: number
        last6Years: { createdAt: Date; total: number }[]
        currentYear: number
        previousYear: number
        yearlyChange: number
        yearlyChangePercent: number
    }
}

export function useDashboard() {
    return useApiQuery<DashboardData>(
        queryKeys.dashboard.summary(),
        "/api/dashboard",
    )
}
