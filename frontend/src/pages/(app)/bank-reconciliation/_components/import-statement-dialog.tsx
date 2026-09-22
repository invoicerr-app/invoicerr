import { zodResolver } from "@hookform/resolvers/zod"
import { useEffect, useMemo, useRef, useState } from "react"
import type React from "react"
import { type FieldValues, useForm, useFormContext, type UseFormReturn } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { FileUp, Upload } from "lucide-react"
import { z } from "zod"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import CurrencySelect from "@/components/currency-select"
import { fromMinor, decimalsFor, toMinor } from "@/components/documents/totals-calculator"
import { EmptyState } from "@/components/ui/empty-state"
import { FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { type SteppedDialogStep, SteppedDialog } from "@/components/ui/stepped-dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"
import { ApiError } from "@/hooks/use-api-query"
import { useCompany, useImportBankStatement } from "@/hooks/queries"
import type {
  CsvDateFormat,
  CsvDecimalSeparator,
  ImportBankStatementResult,
} from "@/types/bank-reconciliation"

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

/** Client-side mirror of the backend's own `detectCsvDelimiter`/header split/row split
 *  (`parse-csv.ts`) — used ONLY to drive this dialog's own screens (the mapping form's dropdowns, the
 *  "first rows" preview, and the full "lines to import" table); the backend re-parses the full file
 *  authoritatively once submitted, so a mismatch here costs nothing beyond a confusing preview, never
 *  a wrong import. */
function detectCsvDelimiter(headerLine: string): "," | ";" {
  const commas = (headerLine.match(/,/g) ?? []).length
  const semicolons = (headerLine.match(/;/g) ?? []).length
  return semicolons > commas ? ";" : ","
}

function splitHeaderRow(line: string): string[] {
  const commas = (line.match(/,/g) ?? []).length
  const semicolons = (line.match(/;/g) ?? []).length
  const delimiter = semicolons > commas ? ";" : ","
  return line.split(delimiter).map((header) => header.trim().replace(/^"|"$/g, ""))
}

function splitCsvLine(line: string, delimiter: string): string[] {
  const fields: string[] = []
  let current = ""
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        current += char
      }
    } else if (char === '"') {
      inQuotes = true
    } else if (char === delimiter) {
      fields.push(current)
      current = ""
    } else {
      current += char
    }
  }
  fields.push(current)
  return fields.map((field) => field.trim())
}

function csvDataRows(text: string, delimiter: string, headers: string[]): Record<string, string>[] {
  const rawLines = text.split(/\r\n|\r|\n/).filter((line) => line.length > 0)
  return rawLines.slice(1).map((line) => {
    const fields = splitCsvLine(line, delimiter)
    const row: Record<string, string> = {}
    headers.forEach((header, index) => {
      row[header] = fields[index] ?? ""
    })
    return row
  })
}

/** `.ofx`/`.qfx` by extension, or the OFX root tag in the bytes — the exact same two-signal detection
 *  the backend's own `detectStatementFormat` uses; kept ONLY to decide which screens THIS dialog
 *  shows, never trusted as the actual import decision (the backend decides that again, independently,
 *  from the real uploaded bytes). */
function looksLikeOfx(fileName: string, text: string): boolean {
  if (/\.(ofx|qfx)$/i.test(fileName)) return true
  if (/\.csv$/i.test(fileName)) return false
  return /<OFX>/i.test(text)
}

function parsePreviewAmount(raw: string, decimalSeparator: CsvDecimalSeparator): number | null {
  const thousandsSeparator = decimalSeparator === "," ? "." : ","
  const stripped = raw
    .trim()
    .replace(/[^\d,.\-+]/g, "")
    .split(thousandsSeparator)
    .join("")
  const normalized = decimalSeparator === "," ? stripped.replace(",", ".") : stripped
  const value = Number(normalized)
  return normalized === "" || !Number.isFinite(value) ? null : value
}

function parsePreviewCsvDate(raw: string, format: CsvDateFormat): Date | null {
  const trimmed = raw.trim()
  let year: number
  let month: number
  let day: number
  if (format === "YYYY-MM-DD") {
    const match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(trimmed)
    if (!match) return null
    year = Number(match[1])
    month = Number(match[2])
    day = Number(match[3])
  } else {
    const match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(trimmed)
    if (!match) return null
    const first = Number(match[1])
    const second = Number(match[2])
    year = Number(match[3])
    if (format === "DD/MM/YYYY") {
      day = first
      month = second
    } else {
      month = first
      day = second
    }
  }
  const date = new Date(Date.UTC(year, month - 1, day))
  return Number.isNaN(date.getTime()) || date.getUTCMonth() !== month - 1 ? null : date
}

function parsePreviewOfxDate(raw: string): Date | null {
  const match = /^(\d{4})(\d{2})(\d{2})/.exec(raw)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return Number.isNaN(date.getTime()) || date.getUTCMonth() !== month - 1 ? null : date
}

function extractOfxTag(block: string, tag: string): string | null {
  const closed = new RegExp(`<${tag}>([^<]*)</${tag}>`, "i").exec(block)
  if (closed) return closed[1].trim()
  const open = new RegExp(`<${tag}>([^<\r\n]*)`, "i").exec(block)
  return open ? open[1].trim() : null
}

/** One row of the "Aperçu" table — successfully parsed only (a row this dialog's own preview could
 *  not read is counted in `PreviewResult.errorCount`, never shown as a phantom line, same "never
 *  silent, never blocking" posture the backend's own parsers hold). `isDuplicate` flags every
 *  occurrence PAST THE FIRST that shares the same (date, amount, label, reference) signature within
 *  THIS file — a real recurring failure mode of bank exports (an overlapping date range re-downloaded,
 *  a bank that double-posts a transaction), never a check against statements already imported earlier
 *  (this dialog never fetches those, and the backend does not offer a dedup endpoint to compare
 *  against — this is a same-file heuristic, stated here so it is never mistaken for one). */
interface PreviewLine {
  key: string
  date: Date | null
  label: string
  amountMinor: number | null
  reference: string | null
  isDuplicate: boolean
}

interface PreviewResult {
  lines: PreviewLine[]
  errorCount: number
  totalMinor: number
}

const EMPTY_PREVIEW: PreviewResult = { lines: [], errorCount: 0, totalMinor: 0 }

function signatureOf(date: Date, amountMinor: number, label: string, reference: string | null): string {
  return `${date.toISOString()}|${amountMinor}|${label.trim().toLowerCase()}|${reference ?? ""}`
}

function buildCsvPreview(
  text: string,
  mapping: {
    dateColumn: string
    amountColumn: string
    labelColumn: string
    referenceColumn?: string
    dateFormat: CsvDateFormat
    decimalSeparator: CsvDecimalSeparator
  },
  currency: string,
): PreviewResult {
  const rawLines = text.split(/\r\n|\r|\n/).filter((line) => line.length > 0)
  if (rawLines.length === 0) return EMPTY_PREVIEW
  const delimiter = detectCsvDelimiter(rawLines[0])
  const headers = splitHeaderRow(rawLines[0])
  const requiredColumns = [mapping.dateColumn, mapping.amountColumn, mapping.labelColumn]
  if (!requiredColumns.every((column) => headers.includes(column))) return EMPTY_PREVIEW

  const rows = csvDataRows(text, delimiter, headers)
  const lines: PreviewLine[] = []
  const seen = new Set<string>()
  let errorCount = 0

  rows.forEach((row, index) => {
    const date = parsePreviewCsvDate(row[mapping.dateColumn] ?? "", mapping.dateFormat)
    const amountMajor = parsePreviewAmount(row[mapping.amountColumn] ?? "", mapping.decimalSeparator)
    if (!date || amountMajor === null) {
      errorCount++
      return
    }
    const amountMinor = toMinor(amountMajor, currency)
    const label = row[mapping.labelColumn] ?? ""
    const reference = mapping.referenceColumn ? row[mapping.referenceColumn] || null : null
    const signature = signatureOf(date, amountMinor, label, reference)
    const isDuplicate = seen.has(signature)
    seen.add(signature)
    lines.push({ key: String(index), date, label, amountMinor, reference, isDuplicate })
  })

  return { lines, errorCount, totalMinor: lines.reduce((sum, line) => sum + (line.amountMinor ?? 0), 0) }
}

function buildOfxPreview(text: string, currency: string): PreviewResult {
  const blocks = text.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) ?? []
  const lines: PreviewLine[] = []
  const seen = new Set<string>()
  let errorCount = 0

  blocks.forEach((block, index) => {
    const dtposted = extractOfxTag(block, "DTPOSTED")
    const trnamt = extractOfxTag(block, "TRNAMT")
    const date = dtposted ? parsePreviewOfxDate(dtposted) : null
    const amountMajor = trnamt ? Number(trnamt) : NaN
    if (!date || !trnamt || !Number.isFinite(amountMajor)) {
      errorCount++
      return
    }
    const amountMinor = toMinor(amountMajor, currency)
    const label = extractOfxTag(block, "MEMO") || extractOfxTag(block, "NAME") || ""
    const reference = extractOfxTag(block, "FITID")
    const signature = signatureOf(date, amountMinor, label, reference)
    const isDuplicate = seen.has(signature)
    seen.add(signature)
    lines.push({ key: String(index), date, label, amountMinor, reference, isDuplicate })
  })

  return { lines, errorCount, totalMinor: lines.reduce((sum, line) => sum + (line.amountMinor ?? 0), 0) }
}

const DATE_FORMATS = ["YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY"] as const
const DECIMAL_SEPARATORS = [".", ","] as const
const NO_REFERENCE_COLUMN = "__none__"

interface ImportFormValues {
  file: File | null
  currency: string
  dateColumn: string
  amountColumn: string
  labelColumn: string
  referenceColumn: string
  dateFormat: CsvDateFormat
  decimalSeparator: CsvDecimalSeparator
}

const DEFAULT_VALUES: ImportFormValues = {
  file: null,
  currency: "",
  dateColumn: "",
  amountColumn: "",
  labelColumn: "",
  referenceColumn: NO_REFERENCE_COLUMN,
  dateFormat: "DD/MM/YYYY",
  decimalSeparator: ",",
}

/** One column-mapping dropdown (date/amount/label/reference) — hoisted to module scope rather than
 *  defined inside `ColumnsStep`: a component defined INSIDE another component's render body gets a
 *  fresh identity every render, which React treats as a different component type and remounts (the
 *  select would close/reset on every keystroke elsewhere in the form). */
function ColumnField({
  name,
  label,
  headers,
  dataCy,
  allowNone,
}: {
  name: "dateColumn" | "amountColumn" | "labelColumn" | "referenceColumn"
  label: string
  headers: string[]
  dataCy: string
  allowNone?: boolean
}) {
  const { t } = useTranslation()
  const { control } = useFormContext<ImportFormValues>()
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel required={!allowNone}>{label}</FormLabel>
          <Select value={field.value} onValueChange={field.onChange}>
            <SelectTrigger dataCy={dataCy}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {allowNone && (
                <SelectItem value={NO_REFERENCE_COLUMN}>
                  {t("bankReconciliation.import.mapping.none")}
                </SelectItem>
              )}
              {headers.map((header) => (
                <SelectItem key={header} value={header}>
                  {header}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

/**
 * Step 1 — the file itself: drop/browse, the detected format (self-describing — no mapping
 * question yet), and the currency the imported lines settle in. This app has no bank-ACCOUNT entity
 * (`BankStatement` carries no account/IBAN field — see the schema), so there is no "target account"
 * picker to wire here beyond that currency, the one per-statement identity that already exists.
 */
function FileStep({
  fileInputRef,
  dragOver,
  setDragOver,
  onFile,
  format,
}: {
  fileInputRef: React.RefObject<HTMLInputElement | null>
  dragOver: boolean
  setDragOver: (value: boolean) => void
  onFile: (file: File) => void
  format: "CSV" | "OFX" | null
}) {
  const { t } = useTranslation()
  const { control, watch } = useFormContext<ImportFormValues>()
  const file = watch("file")

  const openPicker = () => fileInputRef.current?.click()

  return (
    <div className="space-y-4" data-cy="bank-reconciliation-import-file-step">
      <div
        role="button"
        tabIndex={0}
        className={cn(
          "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-center transition-colors",
          dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/25",
        )}
        onDragOver={(event) => {
          event.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragOver(false)
          const dropped = event.dataTransfer.files?.[0]
          if (dropped) onFile(dropped)
        }}
        onClick={openPicker}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault()
            openPicker()
          }
        }}
        data-cy="bank-reconciliation-import-dropzone"
      >
        <FileUp className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">
          {file ? file.name : t("bankReconciliation.import.dropHint")}
        </p>
        {format && (
          <Badge variant="secondary" data-cy="bank-reconciliation-import-format">
            {t("bankReconciliation.import.detectedFormat", { format })}
          </Badge>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.ofx,.qfx,text/csv,application/x-ofx"
          className="hidden"
          data-cy="bank-reconciliation-import-file-input"
          onChange={(event) => {
            const selected = event.target.files?.[0]
            if (selected) onFile(selected)
          }}
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={(event) => {
            event.stopPropagation()
            openPicker()
          }}
          dataCy="bank-reconciliation-import-browse-button"
        >
          {t("bankReconciliation.import.browse")}
        </Button>
      </div>

      <FormField
        control={control}
        name="file"
        render={() => (
          <FormItem>
            <FormMessage data-cy="bank-reconciliation-import-file-error" />
          </FormItem>
        )}
      />

      <FormField
        control={control}
        name="currency"
        render={({ field }) => (
          <FormItem>
            <FormLabel required>{t("bankReconciliation.import.currency")}</FormLabel>
            <CurrencySelect
              value={field.value}
              onChange={(value) => field.onChange(Array.isArray(value) ? value[0] : value)}
              data-cy="bank-reconciliation-import-currency"
            />
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  )
}

/** Step 2 — CSV only (skipped entirely for OFX, self-describing): the column mapping, populated from
 *  the file's OWN header row so the human only ever picks from what the file actually contains, plus
 *  a 3-row RAW preview (unmapped, header-keyed) so a column choice can be checked against real values
 *  before moving on. */
function ColumnsStep({ headers, parsedText }: { headers: string[]; parsedText: string }) {
  const { t } = useTranslation()
  const { control } = useFormContext<ImportFormValues>()

  const delimiter = useMemo(() => detectCsvDelimiter(parsedText.split(/\r\n|\r|\n/)[0] ?? ""), [parsedText])
  const previewRows = useMemo(
    () => csvDataRows(parsedText, delimiter, headers).slice(0, 3),
    [parsedText, delimiter, headers],
  )

  return (
    <div className="space-y-4" data-cy="bank-reconciliation-import-mapping">
      <p className="text-sm font-medium">{t("bankReconciliation.import.mapping.title")}</p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ColumnField
          name="dateColumn"
          label={t("bankReconciliation.import.mapping.dateColumn")}
          headers={headers}
          dataCy="bank-reconciliation-import-mapping-date"
        />
        <ColumnField
          name="amountColumn"
          label={t("bankReconciliation.import.mapping.amountColumn")}
          headers={headers}
          dataCy="bank-reconciliation-import-mapping-amount"
        />
        <ColumnField
          name="labelColumn"
          label={t("bankReconciliation.import.mapping.labelColumn")}
          headers={headers}
          dataCy="bank-reconciliation-import-mapping-label"
        />
        <ColumnField
          name="referenceColumn"
          label={t("bankReconciliation.import.mapping.referenceColumn")}
          headers={headers}
          dataCy="bank-reconciliation-import-mapping-reference"
          allowNone
        />

        <FormField
          control={control}
          name="dateFormat"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("bankReconciliation.import.mapping.dateFormat")}</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
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
            </FormItem>
          )}
        />

        <FormField
          control={control}
          name="decimalSeparator"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("bankReconciliation.import.mapping.decimalSeparator")}</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
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
            </FormItem>
          )}
        />
      </div>

      {previewRows.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("bankReconciliation.import.mapping.previewTitle")}
          </p>
          <Table data-cy="bank-reconciliation-import-mapping-preview">
            <TableHeader>
              <TableRow>
                {headers.map((header) => (
                  <TableHead key={header} className="whitespace-nowrap">
                    {header}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {previewRows.map((row) => (
                <TableRow key={Object.values(row).join("|")}>
                  {headers.map((header) => (
                    <TableCell key={header} className="max-w-32 truncate whitespace-nowrap">
                      {row[header]}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

/** Step 3 — every line this file would produce, exactly as the backend would parse it (same mapping,
 *  same amount/date rules — see this file's own header comment on the client-side mirror), with
 *  possible in-file duplicates flagged and a running total, before anything is actually imported. */
function PreviewStep({ currency, preview }: { currency: string; preview: PreviewResult }) {
  const { t } = useTranslation()

  if (preview.lines.length === 0) {
    return (
      <EmptyState
        icon={FileUp}
        size="sm"
        title={t("bankReconciliation.import.preview.empty")}
        data-cy="bank-reconciliation-import-preview-empty"
      />
    )
  }

  return (
    <div className="space-y-3" data-cy="bank-reconciliation-import-preview">
      {/* sm and up: a table — Date/Label/Amount/flag comfortably fit. */}
      <div className="hidden sm:block">
        <Table data-cy="bank-reconciliation-import-preview-table">
          <TableHeader>
            <TableRow>
              <TableHead>{t("bankReconciliation.lines.date")}</TableHead>
              <TableHead>{t("bankReconciliation.lines.label")}</TableHead>
              <TableHead className="text-right tabular-nums">
                {t("bankReconciliation.lines.amount")}
              </TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {preview.lines.map((line, index) => (
              <TableRow key={line.key} data-cy={`bank-reconciliation-import-preview-row-${index}`}>
                <TableCell className="tabular-nums whitespace-nowrap">
                  {line.date?.toLocaleDateString()}
                </TableCell>
                <TableCell className="max-w-xs truncate" title={line.label}>
                  {line.label}
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right font-mono tabular-nums whitespace-nowrap",
                    (line.amountMinor ?? 0) < 0 && "text-destructive",
                  )}
                >
                  {fromMinor(line.amountMinor ?? 0, currency).toFixed(decimalsFor(currency))} {currency}
                </TableCell>
                <TableCell>
                  {line.isDuplicate && (
                    <Badge
                      variant="warning"
                      data-cy={`bank-reconciliation-import-preview-duplicate-${index}`}
                    >
                      {t("bankReconciliation.import.preview.duplicate")}
                    </Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Below sm: one card per line — a 4-column table has no room at phone width, and the
          duplicate chip would run off-screen with no visible way to reach it. */}
      <div className="space-y-2 sm:hidden">
        {preview.lines.map((line, index) => (
          <div
            key={line.key}
            className="rounded-md border p-3"
            data-cy={`bank-reconciliation-import-preview-card-${index}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm tabular-nums text-muted-foreground">
                {line.date?.toLocaleDateString()}
              </span>
              <span
                className={cn(
                  "font-mono text-sm tabular-nums whitespace-nowrap",
                  (line.amountMinor ?? 0) < 0 && "text-destructive",
                )}
              >
                {fromMinor(line.amountMinor ?? 0, currency).toFixed(decimalsFor(currency))} {currency}
              </span>
            </div>
            <p className="mt-1 truncate text-sm" title={line.label}>
              {line.label}
            </p>
            {line.isDuplicate && (
              <Badge variant="warning" className="mt-1.5">
                {t("bankReconciliation.import.preview.duplicate")}
              </Badge>
            )}
          </div>
        ))}
      </div>

      <div
        className="flex items-center justify-between border-t pt-3 text-sm font-medium"
        data-cy="bank-reconciliation-import-preview-total"
      >
        <span>{t("bankReconciliation.import.preview.total")}</span>
        <span className={cn("font-mono tabular-nums", preview.totalMinor < 0 && "text-destructive")}>
          {fromMinor(preview.totalMinor, currency).toFixed(decimalsFor(currency))} {currency}
        </span>
      </div>

      {preview.errorCount > 0 && (
        <p className="text-xs text-muted-foreground" data-cy="bank-reconciliation-import-preview-error-note">
          {t("bankReconciliation.import.preview.errorNote", { count: preview.errorCount })}
        </p>
      )}
    </div>
  )
}

/** Step 4 — last step: a short recap before the real import runs, replaced IN PLACE by the outcome
 *  (lines imported vs. ignored) once it has — see `ImportStatementDialog#handleSubmit`'s own comment
 *  on why the dialog stays open across that transition instead of closing immediately. */
function ImportStep({
  fileName,
  currency,
  preview,
  result,
}: {
  fileName: string
  currency: string
  preview: PreviewResult
  result: ImportBankStatementResult | null
}) {
  const { t } = useTranslation()
  const duplicateCount = preview.lines.filter((line) => line.isDuplicate).length

  if (result) {
    return (
      <div className="space-y-4" data-cy="bank-reconciliation-import-result">
        <p className="text-sm font-medium">{t("bankReconciliation.import.result.title")}</p>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{t("bankReconciliation.import.result.imported")}</span>
          <span
            className="font-mono tabular-nums font-medium"
            data-cy="bank-reconciliation-import-result-imported"
          >
            {result.statement.lineCount}
          </span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{t("bankReconciliation.import.result.ignored")}</span>
          <span
            className="font-mono tabular-nums font-medium"
            data-cy="bank-reconciliation-import-result-ignored"
          >
            {result.errors.length}
          </span>
        </div>
        {result.errors.length > 0 && (
          <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md bg-warning p-3 text-xs text-warning-foreground">
            {result.errors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4" data-cy="bank-reconciliation-import-recap">
      <p className="text-sm font-medium">{t("bankReconciliation.import.recap.title")}</p>
      <div className="flex items-center justify-between gap-4 text-sm">
        <span className="text-muted-foreground">{t("bankReconciliation.import.recap.file")}</span>
        <span className="truncate font-medium" title={fileName}>
          {fileName}
        </span>
      </div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{t("bankReconciliation.import.recap.currency")}</span>
        <span className="font-mono">{currency}</span>
      </div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{t("bankReconciliation.import.recap.lines")}</span>
        <span className="font-mono tabular-nums font-medium" data-cy="bank-reconciliation-import-recap-lines">
          {preview.lines.length}
        </span>
      </div>
      {duplicateCount > 0 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{t("bankReconciliation.import.recap.duplicates")}</span>
          <Badge variant="warning">{duplicateCount}</Badge>
        </div>
      )}
      {preview.errorCount > 0 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{t("bankReconciliation.import.recap.ignored")}</span>
          <span className="font-mono tabular-nums">{preview.errorCount}</span>
        </div>
      )}
    </div>
  )
}

interface ImportStatementDialogProps {
  onImported: (statementId: string) => void
}

/**
 * The bank-reconciliation statement import flow — a `SteppedDialog` (owner brief, 2026-09-16: every
 * "big" dialog moves to this shape): File → Columns (CSV only) → Preview → Import. A CSV file gets a
 * per-import COLUMN MAPPING (never a saved profile, never a guess — see the backend's own
 * `parse-csv.ts` header), populated from the file's OWN header row; an OFX/QFX file skips straight to
 * the Preview step (self-describing). The Preview/Import split lets the human see exactly which rows
 * would be created, with in-file duplicates flagged, BEFORE committing — the backend itself never
 * exposes a dry-run endpoint, so this dialog mirrors its parsers client-side (see the parsing helpers
 * above) purely to render that preview; the import call that actually follows re-parses the real
 * bytes server-side, authoritatively, same as before.
 */
export function ImportStatementDialog({ onImported }: ImportStatementDialogProps) {
  const { t } = useTranslation()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { data: company } = useCompany()
  const importStatement = useImportBankStatement()

  const [open, setOpen] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [parsed, setParsed] = useState<{ format: "CSV" | "OFX" | null; headers: string[]; text: string }>({
    format: null,
    headers: [],
    text: "",
  })
  const [result, setResult] = useState<ImportBankStatementResult | null>(null)

  const schema = useMemo(
    () =>
      z.object({
        file: z.custom<File | null>((value) => value instanceof File, {
          message: t("bankReconciliation.import.errors.fileRequired"),
        }),
        currency: z.string().min(1, t("bankReconciliation.import.errors.currencyRequired")),
        dateColumn: z.string().min(1, t("bankReconciliation.import.errors.columnRequired")),
        amountColumn: z.string().min(1, t("bankReconciliation.import.errors.columnRequired")),
        labelColumn: z.string().min(1, t("bankReconciliation.import.errors.columnRequired")),
        referenceColumn: z.string(),
        dateFormat: z.enum(DATE_FORMATS),
        decimalSeparator: z.enum(DECIMAL_SEPARATORS),
      }),
    [t],
  )

  const form = useForm<ImportFormValues>({ resolver: zodResolver(schema), defaultValues: DEFAULT_VALUES })

  const reset = () => {
    form.reset(DEFAULT_VALUES)
    setParsed({ format: null, headers: [], text: "" })
    setResult(null)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  // Resets on REOPEN, never on close: `SteppedDialog` keeps a closING dialog mounted through its own
  // exit animation, still rendering `steps[state.index]` — resetting `parsed` synchronously on close
  // shrinks `steps` (the "columns" step disappears once `parsed.format` clears) out from under an
  // index that still points at "import", crashing that render. Resetting here instead means `steps`
  // never changes shape while the dialog is on screen, closing included; `SteppedDialog`'s own
  // "fresh run every time the dialog is (re)opened" effect runs the same instant, so index 0 is
  // always valid against whatever `steps` this reset just produced.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only open's own transition matters — reset closes over stable setters and must NOT re-run this effect on every render.
  useEffect(() => {
    if (open) reset()
  }, [open])

  const handleFile = async (selected: File) => {
    let text: string
    try {
      text = await selected.text()
    } catch {
      toast.error(t("bankReconciliation.import.errors.fileUnreadable"))
      return
    }
    const ofx = looksLikeOfx(selected.name, text)
    setParsed({
      format: ofx ? "OFX" : "CSV",
      headers: ofx ? [] : splitHeaderRow(text.split(/\r\n|\r|\n/).find((line) => line.length > 0) ?? ""),
      text,
    })
    // A freshly picked file resets any mapping chosen for a PREVIOUS one — its headers may differ
    // entirely, and a stale mapping pointing at a column this new file doesn't have must not survive.
    form.setValue("file", selected, { shouldValidate: true, shouldDirty: true })
    form.setValue("dateColumn", "", { shouldDirty: true })
    form.setValue("amountColumn", "", { shouldDirty: true })
    form.setValue("labelColumn", "", { shouldDirty: true })
    form.setValue("referenceColumn", NO_REFERENCE_COLUMN, { shouldDirty: true })
    if (!form.getValues("currency") && company?.currency) {
      form.setValue("currency", company.currency, { shouldValidate: true, shouldDirty: true })
    }
  }

  // Subscribes this render to every field change — cheap at this form's size, and the one way the
  // preview (and the "Import N lines" button label) can stay live as the human adjusts the mapping.
  const watched = form.watch()

  const preview = useMemo<PreviewResult>(() => {
    if (!parsed.text || !parsed.format || !watched.currency) return EMPTY_PREVIEW
    if (parsed.format === "OFX") return buildOfxPreview(parsed.text, watched.currency)
    if (!watched.dateColumn || !watched.amountColumn || !watched.labelColumn) return EMPTY_PREVIEW
    return buildCsvPreview(
      parsed.text,
      {
        dateColumn: watched.dateColumn,
        amountColumn: watched.amountColumn,
        labelColumn: watched.labelColumn,
        referenceColumn:
          watched.referenceColumn === NO_REFERENCE_COLUMN ? undefined : watched.referenceColumn,
        dateFormat: watched.dateFormat,
        decimalSeparator: watched.decimalSeparator,
      },
      watched.currency,
    )
  }, [
    parsed.text,
    parsed.format,
    watched.currency,
    watched.dateColumn,
    watched.amountColumn,
    watched.labelColumn,
    watched.referenceColumn,
    watched.dateFormat,
    watched.decimalSeparator,
  ])

  // The FIRST click on the last step's primary button (label "Import N lines") runs the real import
  // and shows its outcome IN PLACE (see ImportStep) rather than closing — the human came here to see
  // "did it work", not to guess from a toast that might already have scrolled away. Once `result`
  // exists, the SAME button (now reading `common.finish`) just closes: a second real import is never
  // one click away by accident.
  async function handleSubmit() {
    if (result) {
      // Never `reset()` here: that would shrink `steps` (dropping the "columns" step once
      // `parsed.format` clears) WHILE `SteppedDialog`'s own step index still points at the "import"
      // step — Radix keeps the closing dialog mounted for its exit animation, so it would still be
      // rendering with a now out-of-range index and crash. The reopen-triggered effect below is the
      // only place state resets, exactly matching `SteppedDialog`'s own "fresh run on reopen" rule.
      setOpen(false)
      return
    }
    const values = form.getValues()
    if (!values.file) return
    try {
      const base64 = await fileToBase64(values.file)
      const response = await importStatement.mutateAsync({
        fileName: values.file.name,
        base64,
        currency: values.currency,
        mapping:
          parsed.format === "OFX"
            ? undefined
            : {
                dateColumn: values.dateColumn,
                amountColumn: values.amountColumn,
                labelColumn: values.labelColumn,
                referenceColumn:
                  values.referenceColumn === NO_REFERENCE_COLUMN ? undefined : values.referenceColumn,
                dateFormat: values.dateFormat,
                decimalSeparator: values.decimalSeparator,
              },
      })
      setResult(response)
      // Marks the form clean now that the import already happened — closing the dialog from here
      // (the X button, Escape) must never ask "discard changes?" over something already saved.
      form.reset(values)
      onImported(response.statement.id)
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("bankReconciliation.import.error"))
    }
  }

  const steps: SteppedDialogStep[] = [
    {
      id: "file",
      label: t("bankReconciliation.import.steps.file"),
      fields: ["file", "currency"],
      render: () => (
        <FileStep
          fileInputRef={fileInputRef}
          dragOver={dragOver}
          setDragOver={setDragOver}
          onFile={(file) => void handleFile(file)}
          format={parsed.format}
        />
      ),
    },
  ]
  if (parsed.format === "CSV") {
    steps.push({
      id: "columns",
      label: t("bankReconciliation.import.steps.columns"),
      fields: ["dateColumn", "amountColumn", "labelColumn"],
      render: () => <ColumnsStep headers={parsed.headers} parsedText={parsed.text} />,
    })
  }
  steps.push({
    id: "preview",
    label: t("bankReconciliation.import.steps.preview"),
    fields: [],
    render: () => <PreviewStep currency={watched.currency} preview={preview} />,
  })
  steps.push({
    id: "import",
    label: t("bankReconciliation.import.steps.import"),
    fields: [],
    render: () => (
      <ImportStep
        fileName={watched.file?.name ?? ""}
        currency={watched.currency}
        preview={preview}
        result={result}
      />
    ),
  })

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)} dataCy="bank-reconciliation-import-button">
        <Upload className="h-4 w-4 mr-0 md:mr-2" />
        <span className="hidden md:inline-flex">{t("bankReconciliation.import.button")}</span>
      </Button>

      <SteppedDialog
        steps={steps}
        form={form as unknown as UseFormReturn<FieldValues>}
        onSubmit={handleSubmit}
        submitLabel={
          result
            ? t("common.finish")
            : t("bankReconciliation.import.result.submitCount", { count: preview.lines.length })
        }
        open={open}
        onOpenChange={setOpen}
        title={t("bankReconciliation.import.title")}
        submitting={importStatement.isPending}
        dataCy="bank-reconciliation-import-dialog"
        submitDataCy="bank-reconciliation-import-submit"
      />
    </>
  )
}
