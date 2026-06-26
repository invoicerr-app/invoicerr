import { useEffect } from "react"
import { useLocation, useNavigate } from "react-router"

import { PaymentPdfModal } from "@/pages/(app)/payments/_components/payment-pdf-view"
import type { Payment } from "@/types"

export default function PaymentPdfPage() {
    const { state } = useLocation()
    const navigate = useNavigate()
    const payment = (state?.payment as Payment | undefined) ?? null

    useEffect(() => {
        // Direct navigation/refresh without the payment in navigation state isn't
        // supported (no extra fetch-by-id round trip just for this edge case).
        if (!payment) {
            navigate("/payments")
        }
    }, [payment, navigate])

    return (
        <PaymentPdfModal
            payment={payment}
            onOpenChange={(open) => {
                if (!open) navigate("/payments")
            }}
        />
    )
}
