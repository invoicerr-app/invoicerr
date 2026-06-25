import { FormControl, FormItem, FormLabel } from "@/components/ui/form"

import { BetterInput } from "@/components/better-input"
import type { DistributedItem } from "@/lib/payment-distribution"
import { useTranslation } from "react-i18next"

interface PaymentBreakdownProps {
    items: DistributedItem[]
    currency?: string
    /** When true, each item amount can be edited (parent recomputes the total). */
    editable?: boolean
    /** Bump this whenever the items are recomputed from the total, to remount the (uncontrolled) editable inputs. */
    redistributeKey?: number
    onItemChange?: (index: number, amount: number) => void
}

/**
 * Display of how a payment total is split across an invoice's items, with each
 * item's live proportion of the total. Shared by the payment creation form and
 * the "payment received" dialog; the per-item amount is editable when `editable`.
 */
export function PaymentBreakdown({ items, currency, editable, redistributeKey = 0, onItemChange }: PaymentBreakdownProps) {
    const { t } = useTranslation()

    if (items.length === 0) return null

    const total = items.reduce((sum, item) => sum + item.amountPaid, 0)

    return (
        <FormItem className="flex flex-col gap-2 mt-2">
            <FormLabel className="mb-0">{t("payments.breakdown.label")}</FormLabel>
            <div className="flex flex-col gap-2">
                {items.map((item, index) => (
                    <div className="flex gap-2 items-center" key={item.invoiceItemId}>
                        <FormItem className="flex-1">
                            <FormControl>
                                <BetterInput value={item.description || ""} disabled />
                            </FormControl>
                        </FormItem>
                        <span className="text-sm text-muted-foreground w-12 text-right shrink-0">
                            {total !== 0 ? Math.round((item.amountPaid / total) * 100) : 0}%
                        </span>
                        <FormItem>
                            <FormControl>
                                {editable ? (
                                    <BetterInput
                                        key={`${item.invoiceItemId}-${redistributeKey}`}
                                        defaultValue={item.amountPaid}
                                        type="number"
                                        step="0.01"
                                        postAdornment={currency || ""}
                                        onChange={(e) => {
                                            const value = Number.parseFloat(e.target.value)
                                            onItemChange?.(index, Number.isNaN(value) ? 0 : value)
                                        }}
                                    />
                                ) : (
                                    <BetterInput value={item.amountPaid} type="number" postAdornment={currency || ""} disabled />
                                )}
                            </FormControl>
                        </FormItem>
                    </div>
                ))}
            </div>
        </FormItem>
    )
}
