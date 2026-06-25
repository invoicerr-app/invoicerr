import { useEffect } from "react"
import { useLocation, useNavigate } from "react-router"

import { QuotePdfModal } from "@/pages/(app)/quotes/_components/quote-pdf-view"
import type { Quote } from "@/types"

export default function QuotePdfPage() {
    const { state } = useLocation()
    const navigate = useNavigate()
    const quote = (state?.quote as Quote | undefined) ?? null

    useEffect(() => {
        // Direct navigation/refresh without the quote in navigation state isn't
        // supported (no extra fetch-by-id round trip just for this edge case).
        if (!quote) {
            navigate("/quotes")
        }
    }, [quote, navigate])

    return (
        <QuotePdfModal
            quote={quote}
            onOpenChange={(open) => {
                if (!open) navigate("/quotes")
            }}
        />
    )
}
