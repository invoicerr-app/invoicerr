export interface TableExportColumn<T> {
    /** CSV header label (already translated). */
    header: string
    /** Cell value for a row (already formatted). */
    cell: (row: T) => string
}

function csvEscape(value: string) {
    if (/[",\n]/.test(value)) {
        return `"${value.replace(/"/g, '""')}"`
    }
    return value
}

/**
 * CSV export shared by the invoice/quote/payment tables: builds the
 * header/rows from the column definitions and triggers a client-side
 * download of the file.
 */
export function useTableExport<T>(rows: T[], columns: TableExportColumn<T>[], filename: string) {
    const handleExport = () => {
        const header = columns.map((column) => column.header)
        const lines = rows.map((row) => columns.map((column) => column.cell(row)))

        const csv = [header, ...lines]
            .map((line) => line.map((cell) => csvEscape(String(cell))).join(","))
            .join("\n")

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
