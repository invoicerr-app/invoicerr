import { toCsvLine } from "@/lib/csv"

export interface TableExportColumn<T> {
  /** CSV header label (already translated). */
  header: string
  /** Cell value for a row (already formatted). */
  cell: (row: T) => string
}

/**
 * CSV export shared by the invoice/quote/payment tables: builds the
 * header/rows from the column definitions and triggers a client-side
 * download of the file.
 *
 * Cell escaping — RFC 4180 quoting AND the spreadsheet-formula guard — is `lib/csv.ts`, never a
 * local copy: a cell here carries a client name, a document reference, a payment label, all of it
 * text a customer typed, and any of it beginning `=`, `+`, `-` or `@` is a formula the spreadsheet
 * executes on open. That file's own header covers why a negative amount is left bare.
 */
export function useTableExport<T>(rows: T[], columns: TableExportColumn<T>[], filename: string) {
  const handleExport = () => {
    const header = columns.map((column) => column.header)
    const lines = rows.map((row) => columns.map((column) => column.cell(row)))

    const csv = [header, ...lines].map((line) => toCsvLine(line.map((cell) => String(cell)))).join("\n")

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  return { handleExport }
}
