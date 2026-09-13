import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ApiError } from "@/hooks/use-api-query"
import { useCompany, useGenerateInvoiceFromTimeEntries } from "@/hooks/queries"
import { currencies } from "@/lib/constants/currencies"
import type { GenerateInvoiceFromTimeEntriesResult, TimeEntry } from "@/types"

interface GenerateInvoiceDialogProps {
  clientId: string
  entries: TimeEntry[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onGenerated: (result: GenerateInvoiceFromTimeEntriesResult) => void
}

function lineTotal(entry: TimeEntry): number {
  return (entry.durationMinutes / 60) * (entry.effectiveHourlyRate ?? 0)
}

export function GenerateInvoiceDialog({
  clientId,
  entries,
  open,
  onOpenChange,
  onGenerated,
}: GenerateInvoiceDialogProps) {
  const { t } = useTranslation()
  const { data: company } = useCompany()
  const currencySymbol = company?.currency ? currencies[company.currency]?.symbol : ""
  const { mutateAsync: generateInvoice, isPending } = useGenerateInvoiceFromTimeEntries()

  const total = entries.reduce((sum, entry) => sum + lineTotal(entry), 0)

  const handleConfirm = async () => {
    try {
      const result = await generateInvoice({ clientId, entryIds: entries.map((entry) => entry.id) })
      toast.success(t("timeTracking.generateInvoice.messages.success"))
      onOpenChange(false)
      onGenerated(result)
    } catch (err) {
      console.error(err)
      // A 409 here means someone else billed one of these entries in the meantime (the double-billing
      // guard — see the backend's TimeEntriesService.billToInvoice) — a DIFFERENT, more specific
      // message than a plain failure, so the user understands to just reload the list rather than retry
      // the exact same click.
      toast.error(
        err instanceof ApiError && err.status === 409
          ? t("timeTracking.generateInvoice.messages.conflict")
          : t("timeTracking.generateInvoice.messages.error"),
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full max-w-[calc(100%-2rem)] sm:max-w-xl" dataCy="generate-invoice-dialog">
        <DialogHeader>
          <DialogTitle>{t("timeTracking.generateInvoice.title")}</DialogTitle>
        </DialogHeader>

        <div className="max-h-80 overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("timeTracking.generateInvoice.columns.description")}</TableHead>
                <TableHead className="text-right">
                  {t("timeTracking.generateInvoice.columns.hours")}
                </TableHead>
                <TableHead className="text-right">
                  {t("timeTracking.generateInvoice.columns.total")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.id} data-cy={`generate-invoice-row-${entry.id}`}>
                  <TableCell>{entry.description || entry.project.name}</TableCell>
                  <TableCell className="text-right">{(entry.durationMinutes / 60).toFixed(2)}</TableCell>
                  <TableCell className="text-right">
                    {lineTotal(entry).toFixed(2)}
                    {currencySymbol}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="flex justify-end font-medium" data-cy="generate-invoice-total">
          {t("timeTracking.generateInvoice.total")}: {total.toFixed(2)}
          {currencySymbol}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            {t("timeTracking.actions.cancel")}
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isPending || entries.length === 0}
            dataCy="generate-invoice-confirm"
          >
            {t("timeTracking.generateInvoice.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default GenerateInvoiceDialog
