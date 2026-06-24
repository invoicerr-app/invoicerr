import { FormControl, FormItem, FormLabel } from "@/components/ui/form"

import { BetterInput } from "@/components/better-input"
import type { DistributedItem } from "@/lib/payment-distribution"
import { useTranslation } from "react-i18next"

interface PaymentBreakdownProps {
    items: DistributedItem[]
    currency?: string
}

/**
 * Read-only display of how a payment total is split across an invoice's items,
 * with each item's proportion of the invoice. Shared by the payment creation
 * form and the "payment received" dialog.
 */
export function PaymentBreakdown({ items, currency }: PaymentBreakdownProps) {
    const { t } = useTranslation()

    if (items.length === 0) return null

    return (
        <FormItem className="flex flex-col gap-2 mt-2">
            <FormLabel className="mb-0">{t("payments.breakdown.label")}</FormLabel>
            <div className="flex flex-col gap-2">
                {items.map(item => (
                    <div className="flex gap-2 items-center" key={item.invoiceItemId}>
                        <FormItem className="flex-1">
                            <FormControl>
                                <BetterInput value={item.description || ""} disabled />
                            </FormControl>
                        </FormItem>
                        <span className="text-sm text-muted-foreground w-12 text-right shrink-0">
                            {Math.round(item.proportion * 100)}%
                        </span>
                        <FormItem>
                            <FormControl>
                                <BetterInput value={item.amountPaid} type="number" postAdornment={currency || ""} disabled />
                            </FormControl>
                        </FormItem>
                    </div>
                ))}
            </div>
        </FormItem>
    )
}
