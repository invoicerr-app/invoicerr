import { Badge } from "@/components/ui/badge"
import { BetterInput } from "@/components/better-input"
import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { useGet, usePost } from "@/hooks/use-fetch"
import { queryKeys } from "@/lib/query-keys"
import { useQueryClient } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import type { Invoice, Quote } from "@/types"
import { useNavigate } from "react-router"
import { useTranslation } from "react-i18next"

interface QuoteInvoicingStatusItem {
    quoteItemId: string
    name: string
    quantity: number
    invoicedQuantity: number
    remainingQuantity: number
    remainingTTC: number
}

interface QuoteInvoicingStatus {
    items: QuoteInvoicingStatusItem[]
    totalTTC: number
    remainingTTC: number
    remainingPercent: number
}

interface CreateInvoiceFromQuoteDialogProps {
    quote: Quote | null
    onOpenChange: (open: boolean) => void
}

export function CreateInvoiceFromQuoteDialog({ quote, onOpenChange }: CreateInvoiceFromQuoteDialogProps) {
    const { t } = useTranslation()
    const queryClient = useQueryClient()
    const navigate = useNavigate()

    const { data: invoicingStatus, loading } = useGet<QuoteInvoicingStatus>(
        quote ? `/api/quotes/${quote.id}/invoicing-status` : null,
    )

    const { trigger: triggerCreateInvoice, loading: creating } = usePost<Invoice>(`/api/invoices/create-from-quote`)

    const [quantities, setQuantities] = useState<Record<string, number>>({})
    const [percentInput, setPercentInput] = useState<string>("")
    const [amountInput, setAmountInput] = useState<string>("")
    const [redistributeKey, setRedistributeKey] = useState(0)

    useEffect(() => {
        setQuantities({})
        setPercentInput("")
        setAmountInput("")
        setRedistributeKey(k => k + 1)
    }, [quote?.id, invoicingStatus])

    const status = invoicingStatus
    const remainingPercent = status?.remainingPercent ?? 0
    const remainingTTC = status?.remainingTTC ?? 0
    const totalTTC = status?.totalTTC ?? quote?.totalTTC ?? 0

    const itemTTCPerUnit = useMemo(() => {
        const map: Record<string, number> = {}
        status?.items.forEach(item => {
            map[item.quoteItemId] = item.remainingQuantity > 0 ? item.remainingTTC / item.remainingQuantity : 0
        })
        return map
    }, [status])

    const selectedTTC = useMemo(() => {
        if (!status) return 0
        return status.items.reduce((sum, item) => {
            const q = quantities[item.quoteItemId] ?? 0
            if (q <= 0) return sum
            return sum + q * (itemTTCPerUnit[item.quoteItemId] ?? 0)
        }, 0)
    }, [status, quantities, itemTTCPerUnit])

    const selectedPercent = totalTTC > 0 ? (selectedTTC / totalTTC) * 100 : 0

    /** Distributes a raw TTC target proportionally across remaining item quantities,
     * clamped to what's actually invoicable, and syncs the *other* input (percent or
     * amount) to the value that was actually applied. The input the user is actively
     * typing in is left untouched so reformatting doesn't fight their keystrokes. */
    const distributeFromTargetTTC = (targetTTC: number, source: "percent" | "amount") => {
        if (!status || remainingTTC <= 0) return
        const clampedTTC = Math.min(Math.max(targetTTC, 0), remainingTTC)
        const next: Record<string, number> = {}
        status.items.forEach(item => {
            if (item.remainingQuantity <= 0) {
                next[item.quoteItemId] = 0
                return
            }
            const q = (clampedTTC * item.remainingQuantity) / remainingTTC
            next[item.quoteItemId] = Math.min(Math.round(q * 1000) / 1000, item.remainingQuantity)
        })
        setQuantities(next)
        setRedistributeKey(k => k + 1)
        if (source !== "percent") {
            const appliedPercent = totalTTC > 0 ? (clampedTTC / totalTTC) * 100 : 0
            setPercentInput(String(Math.round(appliedPercent * 100) / 100))
        }
        if (source !== "amount") {
            setAmountInput(clampedTTC.toFixed(2))
        }
    }

    const handlePercentChange = (value: string) => {
        setPercentInput(value)
        const parsed = value === "" ? 0 : Number.parseFloat(value)
        if (Number.isNaN(parsed)) return
        const clampedPercent = Math.min(Math.max(parsed, 0), remainingPercent)
        distributeFromTargetTTC((clampedPercent / 100) * totalTTC, "percent")
    }

    const handleAmountChange = (value: string) => {
        setAmountInput(value)
        const parsed = value === "" ? 0 : Number.parseFloat(value)
        if (Number.isNaN(parsed)) return
        distributeFromTargetTTC(parsed, "amount")
    }

    const handleQuantityChange = (quoteItemId: string, value: number, max: number) => {
        const clamped = Math.min(Math.max(Number.isNaN(value) ? 0 : value, 0), max)
        setQuantities(prev => {
            const next = { ...prev, [quoteItemId]: clamped }
            const newSelectedTTC = status
                ? status.items.reduce((sum, item) => {
                      const q = next[item.quoteItemId] ?? 0
                      if (q <= 0) return sum
                      return sum + q * (itemTTCPerUnit[item.quoteItemId] ?? 0)
                  }, 0)
                : 0
            const newPercent = totalTTC > 0 ? (newSelectedTTC / totalTTC) * 100 : 0
            setPercentInput(newPercent.toFixed(2).replace(/\.?0+$/, ""))
            setAmountInput(newSelectedTTC.toFixed(2))
            return next
        })
    }

    const handleConfirm = () => {
        if (!quote || !status) return
        const items = status.items
            .map(item => ({
                quoteItemId: item.quoteItemId,
                quantity: quantities[item.quoteItemId] ?? 0,
            }))
            .filter(line => line.quantity > 0)

        if (items.length === 0) return

        triggerCreateInvoice({ quoteId: quote.id, items })
            .then((newInvoice) => {
                toast.success(t("quotes.list.messages.invoiceCreated"))
                queryClient.invalidateQueries({ queryKey: queryKeys.quotes.listsAll() })
                queryClient.invalidateQueries({ queryKey: queryKeys.invoices.listsAll() })
                onOpenChange(false)
                if (newInvoice) {
                    navigate(`/invoices/pdf/${newInvoice.id}`, { state: { invoice: newInvoice } })
                }
            })
            .catch(() => {
                toast.error(t("quotes.list.messages.invoiceCreateError"))
            })
    }

    const hasSelection = Object.values(quantities).some(q => q > 0)
    const open = !!quote

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-sm lg:max-w-2xl min-w-fit max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{t("quotes.createInvoiceDialog.title")}</DialogTitle>
                    <DialogDescription>
                        {t("quotes.createInvoiceDialog.description", {
                            number: quote?.rawNumber || quote?.number,
                        })}
                    </DialogDescription>
                </DialogHeader>

                {loading || !status ? (
                    <div className="flex items-center justify-center py-12">
                        <Spinner className="h-8 w-8" />
                    </div>
                ) : remainingPercent <= 0 ? (
                    <p className="text-sm text-destructive py-6 text-center">
                        {t("quotes.createInvoiceDialog.errors.quoteFullyInvoiced")}
                    </p>
                ) : (
                    <div className="flex flex-col gap-4">
                        <div className="flex flex-col sm:flex-row gap-4">
                            <div className="flex flex-col gap-2 flex-1">
                                <label className="text-sm font-medium" htmlFor="quote-invoice-percent">
                                    {t("quotes.createInvoiceDialog.percentageLabel")}
                                </label>
                                <BetterInput
                                    id="quote-invoice-percent"
                                    type="number"
                                    min={0}
                                    max={Math.round(remainingPercent * 100) / 100}
                                    step="0.01"
                                    postAdornment="%"
                                    value={percentInput}
                                    onChange={e => handlePercentChange(e.target.value)}
                                    data-cy="quote-invoice-percent-input"
                                />
                            </div>
                            <div className="flex flex-col gap-2 flex-1">
                                <label className="text-sm font-medium" htmlFor="quote-invoice-amount">
                                    {t("quotes.createInvoiceDialog.amountLabel")}
                                </label>
                                <BetterInput
                                    id="quote-invoice-amount"
                                    type="number"
                                    min={0}
                                    max={Math.round(remainingTTC * 100) / 100}
                                    step="0.01"
                                    postAdornment={quote?.currency || ""}
                                    value={amountInput}
                                    onChange={e => handleAmountChange(e.target.value)}
                                    data-cy="quote-invoice-amount-input"
                                />
                            </div>
                        </div>
                        <p className="text-xs text-muted-foreground -mt-2">
                            {t("quotes.createInvoiceDialog.maxPercentageHint", {
                                percent: Math.round(remainingPercent * 100) / 100,
                            })}
                        </p>

                        <div className="flex flex-col gap-2">
                            {status.items.map(item => {
                                const remaining = item.remainingQuantity
                                const fullyInvoiced = remaining <= 0
                                const currentQty = quantities[item.quoteItemId] ?? 0
                                const itemTTC = currentQty * (itemTTCPerUnit[item.quoteItemId] ?? 0)

                                return (
                                    <div
                                        key={item.quoteItemId}
                                        className={`flex gap-2 items-center ${fullyInvoiced ? "opacity-60" : ""}`}
                                    >
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm truncate">{item.name}</p>
                                            <p className="text-xs text-muted-foreground">
                                                {t("quotes.createInvoiceDialog.remainingLabel", {
                                                    remaining: remaining,
                                                })}
                                                {" — "}
                                                {t("quotes.createInvoiceDialog.remainingTotalLabel", {
                                                    amount: item.remainingTTC.toFixed(2),
                                                    currency: quote?.currency || "",
                                                })}
                                            </p>
                                        </div>
                                        {fullyInvoiced ? (
                                            <Badge variant="outline" className="shrink-0">
                                                {t("quotes.createInvoiceDialog.alreadyInvoicedBadge")}
                                            </Badge>
                                        ) : (
                                            <>
                                                <BetterInput
                                                    key={`${item.quoteItemId}-${redistributeKey}`}
                                                    defaultValue={currentQty}
                                                    type="number"
                                                    min={0}
                                                    max={remaining}
                                                    step="0.001"
                                                    className="w-24"
                                                    onChange={e => {
                                                        const value = Number.parseFloat(e.target.value)
                                                        handleQuantityChange(item.quoteItemId, value, remaining)
                                                    }}
                                                    data-cy={`quote-invoice-quantity-${item.quoteItemId}`}
                                                />
                                                                                                <span className="text-xs font-medium w-24 text-right shrink-0">
                                                    {t("quotes.createInvoiceDialog.itemAmountLabel", {
                                                        amount: itemTTC.toFixed(2),
                                                        currency: quote?.currency || "",
                                                    })}
                                                </span>
                                            </>
                                        )}
                                    </div>
                                )
                            })}
                        </div>

                        <div className="flex items-center justify-between border-t pt-3 text-sm font-medium">
                            <span>
                                {t("quotes.createInvoiceDialog.totalSelectedLabel", {
                                    amount: selectedTTC.toFixed(2),
                                    currency: quote?.currency || "",
                                })}
                            </span>
                            <span>
                                {t("quotes.createInvoiceDialog.percentOfQuoteLabel", {
                                    percent: Math.round(selectedPercent * 100) / 100,
                                })}
                            </span>
                        </div>
                    </div>
                )}

                <DialogFooter className="flex justify-end space-x-2">
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                        {t("quotes.createInvoiceDialog.actions.cancel")}
                    </Button>
                    <Button
                        type="button"
                        onClick={handleConfirm}
                        loading={creating}
                        disabled={!hasSelection || remainingPercent <= 0}
                        dataCy="quote-invoice-create-submit"
                    >
                        {t("quotes.createInvoiceDialog.actions.confirm")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
