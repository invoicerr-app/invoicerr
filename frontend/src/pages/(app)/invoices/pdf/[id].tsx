import { useEffect } from "react"
import { useLocation, useNavigate } from "react-router"

import { InvoicePdfModal } from "@/pages/(app)/invoices/_components/invoice-pdf-view"
import type { Invoice } from "@/types"

export default function InvoicePdfPage() {
    const { state } = useLocation()
    const navigate = useNavigate()
    const invoice = (state?.invoice as Invoice | undefined) ?? null

    useEffect(() => {
        // Direct navigation/refresh without the invoice in navigation state isn't
        // supported (no extra fetch-by-id round trip just for this edge case).
        if (!invoice) {
            navigate("/invoices")
        }
    }, [invoice, navigate])

    return (
        <InvoicePdfModal
            invoice={invoice}
            onOpenChange={(open) => {
                if (!open) navigate("/invoices")
            }}
        />
    )
}
