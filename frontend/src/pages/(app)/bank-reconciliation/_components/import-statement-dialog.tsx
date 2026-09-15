import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { FileUp, Upload } from "lucide-react"

import { Button } from "@/components/ui/button"
import CurrencySelect from "@/components/currency-select"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ApiError } from "@/hooks/use-api-query"
import { useCompany, useImportBankStatement } from "@/hooks/queries"
import type { CsvDateFormat, CsvDecimalSeparator } from "@/types/bank-reconciliation"

/** Same technique `received-invoice-upload-button.tsx`/`signing-certificates.settings.tsx` already use
 *  for their own binary uploads — no shared util exists for this yet, so this is the third, identical
 *  copy rather than inventing a new shared helper for a one-liner. */
async function fileToBase64(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer()
  let binary = ""
  const bytes = new Uint8Array(arrayBuffer)
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/** Client-side mirror of the backend's own `detectCsvDelimiter`/header split (`parse-csv.ts`) — used
 *  ONLY to populate the mapping form's dropdowns from the file's own header row; the backend re-parses
 *  the full file authoritatively once submitted, so a mismatch here costs nothing beyond a confusing
 *  dropdown, never a wrong import. */
function splitHeaderRow(line: string): string[] {
  const commas = (line.match(/,/g) ?? []).length
  const semicolons = (line.match(/;/g) ?? []).length
  const delimiter = semicolons > commas ? ";" : ","
  return line.split(delimiter).map((header) => header.trim().replace(/^"|"$/g, ""))
}

/** `.ofx`/`.qfx` by extension, or the OFX root tag in the bytes — the exact same two-signal detection
 *  the backend's own `detectStatementFormat` uses; kept ONLY to decide whether THIS dialog shows the
 *  CSV mapping form at all, never trusted as the actual import decision (the backend decides that
 *  again, independently, from the real uploaded bytes). */
function looksLikeOfx(fileName: string, text: string): boolean {
  if (/\.(ofx|qfx)$/i.test(fileName)) return true
  if (/\.csv$/i.test(fileName)) return false
  return /<OFX>/i.test(text)
}

const DATE_FORMATS: CsvDateFormat[] = ["YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY"]
const DECIMAL_SEPARATORS: CsvDecimalSeparator[] = [".", ","]
const NO_REFERENCE_COLUMN = "__none__"

interface ImportStatementDialogProps {
  onImported: (statementId: string) => void
}

/**
 * The bank-reconciliation CSV import flow, made real on screen: a CSV file gets a per-import
 * COLUMN MAPPING form (never a saved profile, never a guess — see the backend's own `parse-csv.ts`
 * header), populated from the file's OWN header row so the human only ever picks from what the file
 * actually contains; an OFX/QFX file skips the mapping entirely (self-describing).
 */
export function ImportStatementDialog({ onImported }: ImportStatementDialogProps) {
  const { t } = useTranslation()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { data: company } = useCompany()
  const importStatement = useImportBankStatement()

  const [open, setOpen] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [isOfx, setIsOfx] = useState(false)
  const [headers, setHeaders] = useState<string[]>([])
  const [currency, setCurrency] = useState("")
  const [dateColumn, setDateColumn] = useState("")
  const [amountColumn, setAmountColumn] = useState("")
  const [labelColumn, setLabelColumn] = useState("")
  const [referenceColumn, setReferenceColumn] = useState(NO_REFERENCE_COLUMN)
  const [dateFormat, setDateFormat] = useState<CsvDateFormat>("DD/MM/YYYY")
  const [decimalSeparator, setDecimalSeparator] = useState<CsvDecimalSeparator>(",")

  const reset = () => {
    setFile(null)
    setIsOfx(false)
    setHeaders([])
    setDateColumn("")
    setAmountColumn("")
    setLabelColumn("")
    setReferenceColumn(NO_REFERENCE_COLUMN)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const handleFile = async (selected: File) => {
    const text = await selected.text()
    const ofx = looksLikeOfx(selected.name, text)
    setFile(selected)
    setIsOfx(ofx)
    if (!ofx) {
      const firstLine = text.split(/\r\n|\r|\n/).find((line) => line.length > 0) ?? ""
      setHeaders(splitHeaderRow(firstLine))
    } else {
      setHeaders([])
    }
    if (!currency && company?.currency) setCurrency(company.currency)
  }

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragOver(false)
    const dropped = event.dataTransfer.files?.[0]
    if (dropped) void handleFile(dropped)
  }

  const canSubmit = file !== null && currency !== "" && (isOfx || (dateColumn && amountColumn && labelColumn))

  const handleSubmit = async () => {
    if (!file || !canSubmit) return
    try {
      const base64 = await fileToBase64(file)
      const result = await importStatement.mutateAsync({
        fileName: file.name,
        base64,
        currency,
        mapping: isOfx
          ? undefined
          : {
              dateColumn,
              amountColumn,
              labelColumn,
              referenceColumn: referenceColumn === NO_REFERENCE_COLUMN ? undefined : referenceColumn,
              dateFormat,
              decimalSeparator,
            },
      })

      if (result.errors.length > 0) {
        toast.warning(
          t("bankReconciliation.import.successWithErrors", {
            count: result.statement.lineCount,
            errorCount: result.errors.length,
          }),
        )
      } else {
        toast.success(t("bankReconciliation.import.success", { count: result.statement.lineCount }))
      }

      setOpen(false)
      reset()
      onImported(result.statement.id)
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("bankReconciliation.import.error"))
    }
  }

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)} dataCy="bank-reconciliation-import-button">
        <Upload className="h-4 w-4 mr-0 md:mr-2" />
        <span className="hidden md:inline-flex">{t("bankReconciliation.import.button")}</span>
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) reset()
        }}
      >
        <DialogContent data-cy="bank-reconciliation-import-dialog" className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("bankReconciliation.import.title")}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div
              className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
                dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/25"
              }`}
              onDragOver={(event) => {
                event.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              data-cy="bank-reconciliation-import-dropzone"
            >
              <FileUp className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {file ? file.name : t("bankReconciliation.import.dropHint")}
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.ofx,.qfx,text/csv,application/x-ofx"
                className="hidden"
                data-cy="bank-reconciliation-import-file-input"
                onChange={(event) => {
                  const selected = event.target.files?.[0]
                  if (selected) void handleFile(selected)
                }}
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={(event) => {
                  event.stopPropagation()
                  fileInputRef.current?.click()
                }}
                dataCy="bank-reconciliation-import-browse-button"
              >
                {t("bankReconciliation.import.browse")}
              </Button>
            </div>

            {file && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>{t("bankReconciliation.import.currency")}</Label>
                  <CurrencySelect
                    value={currency}
                    onChange={(value) => setCurrency(Array.isArray(value) ? value[0] : value)}
                    data-cy="bank-reconciliation-import-currency"
                  />
                </div>

                {!isOfx && (
                  <div
                    className="space-y-3 rounded-md border p-3"
                    data-cy="bank-reconciliation-import-mapping"
                  >
                    <p className="text-sm font-medium">{t("bankReconciliation.import.mapping.title")}</p>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label>{t("bankReconciliation.import.mapping.dateColumn")}</Label>
                        <Select value={dateColumn} onValueChange={setDateColumn}>
                          <SelectTrigger dataCy="bank-reconciliation-import-mapping-date">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {headers.map((header) => (
                              <SelectItem key={header} value={header}>
                                {header}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-1.5">
                        <Label>{t("bankReconciliation.import.mapping.amountColumn")}</Label>
                        <Select value={amountColumn} onValueChange={setAmountColumn}>
                          <SelectTrigger dataCy="bank-reconciliation-import-mapping-amount">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {headers.map((header) => (
                              <SelectItem key={header} value={header}>
                                {header}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-1.5">
                        <Label>{t("bankReconciliation.import.mapping.labelColumn")}</Label>
                        <Select value={labelColumn} onValueChange={setLabelColumn}>
                          <SelectTrigger dataCy="bank-reconciliation-import-mapping-label">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {headers.map((header) => (
                              <SelectItem key={header} value={header}>
                                {header}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-1.5">
                        <Label>{t("bankReconciliation.import.mapping.referenceColumn")}</Label>
                        <Select value={referenceColumn} onValueChange={setReferenceColumn}>
                          <SelectTrigger dataCy="bank-reconciliation-import-mapping-reference">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NO_REFERENCE_COLUMN}>
                              {t("bankReconciliation.import.mapping.none")}
                            </SelectItem>
                            {headers.map((header) => (
                              <SelectItem key={header} value={header}>
                                {header}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-1.5">
                        <Label>{t("bankReconciliation.import.mapping.dateFormat")}</Label>
                        <Select
                          value={dateFormat}
                          onValueChange={(value) => setDateFormat(value as CsvDateFormat)}
                        >
                          <SelectTrigger dataCy="bank-reconciliation-import-mapping-date-format">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {DATE_FORMATS.map((format) => (
                              <SelectItem key={format} value={format}>
                                {format}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-1.5">
                        <Label>{t("bankReconciliation.import.mapping.decimalSeparator")}</Label>
                        <Select
                          value={decimalSeparator}
                          onValueChange={(value) => setDecimalSeparator(value as CsvDecimalSeparator)}
                        >
                          <SelectTrigger dataCy="bank-reconciliation-import-mapping-decimal">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {DECIMAL_SEPARATORS.map((separator) => (
                              <SelectItem key={separator} value={separator}>
                                {separator === "," ? "1 234,56" : "1,234.56"}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              disabled={!canSubmit}
              loading={importStatement.isPending}
              onClick={handleSubmit}
              dataCy="bank-reconciliation-import-submit"
            >
              {t("bankReconciliation.import.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
