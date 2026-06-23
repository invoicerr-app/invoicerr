import { Plus, Receipt as PaymentIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useGetRaw } from "@/hooks/use-fetch"
import { usePayments } from "@/hooks/queries"

import { Button } from "@/components/ui/button"
import type { Payment } from "@/types"
import { usePageHeader } from "@/hooks/use-page-header"
import { useTranslation } from "react-i18next"
import { PaymentList, type PaymentListHandle } from "./_components/payment-list"

export default function Payments() {
    const { t } = useTranslation()
    const paymentListRef = useRef<PaymentListHandle>(null)
    const [page, setPage] = useState(1)
    const { data: payments } = usePayments(page)
    const [downloadPaymentPdf, setDownloadPaymentPdf] = useState<Payment | null>(null)
    const { data: pdf } = useGetRaw<Response>(downloadPaymentPdf ? `/api/payments/${downloadPaymentPdf.id}/pdf` : null)

    useEffect(() => {
        if (downloadPaymentPdf && pdf) {
            pdf.arrayBuffer().then((buffer) => {
                const blob = new Blob([buffer], { type: "application/pdf" })
                const url = URL.createObjectURL(blob)
                const link = document.createElement("a")
                link.href = url
                link.download = `payment-${downloadPaymentPdf.number}.pdf`
                document.body.appendChild(link)
                link.click()
                document.body.removeChild(link)
                URL.revokeObjectURL(url)
                setDownloadPaymentPdf(null)
            })
        }
    }, [downloadPaymentPdf, pdf])

    const [searchTerm, setSearchTerm] = useState("")

    const filteredPayments =
        payments?.payments.filter(
            (payment) =>
                payment.invoice?.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                payment.invoice?.client?.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                payment.rawNumber?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                payment.number?.toString().includes(searchTerm) ||
                payment.invoice?.rawNumber?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                payment.invoice?.number?.toString().includes(searchTerm)
        ) || []

    usePageHeader(t("sidebar.navigation.payments"))

    const emptyState = (
        <div className="text-center py-12">
            <PaymentIcon className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-2 text-sm font-medium text-foreground">
                {searchTerm ? t("payments.emptyState.noResults") : t("payments.emptyState.noPayments")}
            </h3>
            <p className="mt-1 text-sm text-primary">
                {searchTerm ? t("payments.emptyState.tryDifferentSearch") : t("payments.emptyState.startAdding")}
            </p>
            {!searchTerm && (
                <div className="mt-6">
                    <Button onClick={() => paymentListRef.current?.handleAddClick()}>
                        <Plus className="h-4 w-4 mr-2" />
                        {t("payments.actions.addNew")}
                    </Button>
                </div>
            )}
        </div>
    )

    return (
        <div className="max-w-7xl mx-auto space-y-6 p-6">

            <PaymentList
                ref={paymentListRef}
                payments={filteredPayments}
                loading={false}
                searchTerm={searchTerm}
                onSearchChange={setSearchTerm}
                page={page}
                pageCount={payments?.pageCount || 1}
                setPage={setPage}
                emptyState={emptyState}
                showCreateButton={true}
            />
        </div>
    )
}
