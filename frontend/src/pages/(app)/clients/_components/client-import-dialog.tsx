/**
 * The client CSV import dialog - file picker + template download, then a preview (three groups:
 * will be created / rejected with a reason / duplicates with which existing client they match)
 * before anything is written, then a confirm and a result screen. See
 * `backend/src/modules/clients/import/client-import.service.ts`'s own header for the full design
 * (why identifiers are `identifier:<SCHEME>` columns, why custom fields are out of scope, why VIES
 * never runs inside the confirm transaction) and `frontend/src/lib/csv-import/client-rows.ts` for the
 * browser-side parse/validate pass this dialog drives.
 *
 * Deliberately a plain `Dialog`, not the app's `SteppedDialog` - this flow has no per-step field
 * validation gating "Continue" the way a multi-section FORM does (`client-upsert.tsx`'s own wizard);
 * it is a strict, one-way pipeline (pick file -> preview -> confirm -> result) where each stage's
 * whole content replaces the last, which a single dialog body already expresses without a step rail.
 */
import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import type { TFunction } from "i18next"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Download, FileUp, Upload } from "lucide-react"

import { queryKeys } from "@/lib/query-keys"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { authenticatedFetch } from "@/hooks/use-fetch"
import {
  type ClientImportDuplicateMatchWire,
  type ClientImportRowResultWire,
  useImportClientsConfirm,
  useImportClientsPreview,
} from "@/hooks/queries"
import { decodeCsvBytes, detectDelimiter, parseCsv } from "@/lib/csv-parse"
import {
  fetchRequiredIdentifiers,
  mapRow,
  validateRow,
  type ClientImportRowWire,
} from "@/lib/csv-import/client-rows"
import { ApiError } from "@/hooks/use-api-query"

/** Client-side mirror of `MAX_IMPORT_ROWS`/the byte-size reasoning in
 *  `backend/.../import/client-import.types.ts` - checked here FIRST so a human picking an obviously
 *  oversized file gets an immediate, friendly message instead of waiting on a network round-trip the
 *  server would refuse anyway. The server re-checks both independently; this is a convenience, not
 *  the actual enforcement. */
const MAX_IMPORT_FILE_BYTES = 1_000_000
const MAX_IMPORT_ROWS = 1000

type Stage = "pick" | "preview" | "result"

/** The Detail column's own text for a `duplicate` row - names WHICH rule matched (email vs
 *  name+country) and WHERE the match is (an existing, already-saved client, or an earlier row of
 *  this same file), rather than the previous "Matches X" wording, which told a reader THAT a row
 *  collided but not with what kind of record or on what basis. Four i18n keys, one per
 *  (kind, matchedOn) pair - see `clients.import.preview.duplicateOf*` in the EN locale. */
function duplicateDetail(t: TFunction, duplicateOf: ClientImportDuplicateMatchWire | undefined): string {
  if (!duplicateOf) return ""
  if (duplicateOf.kind === "file") {
    return duplicateOf.matchedOn === "email"
      ? t("clients.import.preview.duplicateOfFileEmail", { row: duplicateOf.rowNumber })
      : t("clients.import.preview.duplicateOfFileNameCountry", { row: duplicateOf.rowNumber })
  }
  const name = duplicateOf.name || duplicateOf.contactEmail || ""
  return duplicateOf.matchedOn === "email"
    ? t("clients.import.preview.duplicateOfExistingEmail", { name })
    : t("clients.import.preview.duplicateOfExistingNameCountry", { name })
}

interface MergedRow {
  rowNumber: number
  status: "valid" | "duplicate" | "rejected"
  errors?: string[]
  duplicateOf?: ClientImportDuplicateMatchWire
  wire: ClientImportRowWire
  /** Whether this row's verdict came from the shared zod schema running IN THE BROWSER (never sent
   *  to the server at all) or from the server's own preview check. A "local" rejection is never
   *  resubmitted at confirm time - the server has never validated that row's shape (it may be
   *  missing fields the server-side checks don't look at, like `address`), so resending it could let
   *  it slip through as created instead of staying rejected. See `handleConfirm`'s own comment. */
  source: "local" | "server"
}

export function ClientImportDialog() {
  const { t } = useTranslation()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const previewMutation = useImportClientsPreview()
  const confirmMutation = useImportClientsConfirm()
  const queryClient = useQueryClient()

  const [open, setOpen] = useState(false)
  const [stage, setStage] = useState<Stage>("pick")
  const [busy, setBusy] = useState(false)
  const [fileName, setFileName] = useState("")
  const [rows, setRows] = useState<MergedRow[]>([])
  const [result, setResult] = useState<{ created: number; duplicates: number; rejected: number } | null>(null)

  const reset = () => {
    setStage("pick")
    setBusy(false)
    setFileName("")
    setRows([])
    setResult(null)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) reset()
  }

  const downloadTemplate = async () => {
    try {
      const res = await authenticatedFetch("/api/clients/import/template")
      if (!res.ok) throw new Error("template download failed")
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = "clients-import-template.csv"
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch {
      toast.error(t("clients.import.errors.templateDownload"))
    }
  }

  async function handleFile(file: File) {
    if (file.size > MAX_IMPORT_FILE_BYTES) {
      toast.error(
        t("clients.import.errors.fileTooLarge", { maxKb: Math.round(MAX_IMPORT_FILE_BYTES / 1000) }),
      )
      return
    }
    setBusy(true)
    setFileName(file.name)
    try {
      const buffer = await file.arrayBuffer()
      const text = decodeCsvBytes(buffer)
      const delimiter = detectDelimiter(text.split(/\r\n|\r|\n/)[0] ?? "")
      const { headers, rows: dataRows } = parseCsv(text, delimiter)

      if (dataRows.length === 0) {
        toast.error(t("clients.import.errors.empty"))
        setBusy(false)
        return
      }
      if (dataRows.length > MAX_IMPORT_ROWS) {
        toast.error(t("clients.import.errors.tooManyRows", { max: MAX_IMPORT_ROWS, count: dataRows.length }))
        setBusy(false)
        return
      }

      const mappedRows = dataRows.map((cells, index) => mapRow(headers, cells, index + 2))

      // One catalog fetch per distinct (country, partyType) pair in the whole file, not one per row
      // - see `fetchRequiredIdentifiers`'s own header. This is a BEST-EFFORT local check only: the
      // country here is whatever the row's own `countryCode`/`country` cells literally say, UNRESOLVED
      // (no `guessCountryCode` port on this side - see that function's own header on the backend for
      // why duplicating its country-name table here would just be a second copy to keep in sync). A
      // row whose country cannot actually be resolved, or whose `country`/`countryCode` disagree, is
      // still caught - by the SERVER, in `preview` below, which is the authority on both (this local
      // pass only ever narrows which rows are worth sending at all).
      const requirementsCache = new Map<string, Awaited<ReturnType<typeof fetchRequiredIdentifiers>>>()
      async function requirementsFor(row: ClientImportRowWire) {
        const country = row.countryCode || row.country || ""
        const partyType = row.type === "INDIVIDUAL" ? "INDIVIDUAL" : "COMPANY"
        const key = `${country}\u0000${partyType}`
        if (!requirementsCache.has(key)) {
          requirementsCache.set(key, country ? await fetchRequiredIdentifiers(country, partyType) : [])
        }
        return requirementsCache.get(key)!
      }

      const validated = await Promise.all(
        mappedRows.map(async ({ wire, shapeErrors }) =>
          validateRow(t, wire, shapeErrors, await requirementsFor(wire)),
        ),
      )

      const locallyValid = validated.filter((v) => !v.localErrors)

      let serverResults: ClientImportRowResultWire[] = []
      if (locallyValid.length > 0) {
        const response = await previewMutation.trigger({ rows: locallyValid.map((v) => v.wire) })
        if (!response) {
          toast.error(t("clients.import.errors.previewFailed"))
          setBusy(false)
          return
        }
        serverResults = response.rows
      }

      const byRowNumber = new Map(serverResults.map((r) => [r.rowNumber, r]))
      const merged: MergedRow[] = validated.map((v) => {
        if (v.localErrors) {
          return {
            rowNumber: v.rowNumber,
            status: "rejected",
            errors: v.localErrors,
            wire: v.wire,
            source: "local",
          }
        }
        const serverResult = byRowNumber.get(v.rowNumber)
        return {
          rowNumber: v.rowNumber,
          status: serverResult?.status ?? "rejected",
          errors: serverResult?.errors,
          duplicateOf: serverResult?.duplicateOf,
          wire: v.wire,
          source: "server",
        }
      })
      merged.sort((a, b) => a.rowNumber - b.rowNumber)
      setRows(merged)
      setStage("preview")
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : t("clients.import.errors.parseFailed"))
    } finally {
      setBusy(false)
    }
  }

  const willCreate = rows.filter((r) => r.status === "valid")
  const rejected = rows.filter((r) => r.status === "rejected")
  const duplicates = rows.filter((r) => r.status === "duplicate")

  async function handleConfirm() {
    setBusy(true)
    try {
      // Resends every row the SERVER already evaluated (valid + duplicate + server-rejected) - the
      // exact set the preview call above was given - never a row rejected purely by the browser's
      // own zod pass (`source: "local"`): the server-side checks (`assertClientCreatable`) never look
      // at some of the fields zod does (e.g. `address`), so replaying one of those rows through
      // confirm could let it slip through as CREATED instead of staying rejected. Its own tally is
      // added back in below so the result screen still counts every row in the file, matching what
      // the preview already showed.
      const serverRows = rows.filter((r) => r.source === "server")
      const locallyRejectedCount = rows.length - serverRows.length
      const response = await confirmMutation.trigger({ rows: serverRows.map((r) => r.wire) })
      if (!response) {
        toast.error(t("clients.import.errors.confirmFailed"))
        return
      }
      setResult({ ...response, rejected: response.rejected + locallyRejectedCount })
      setStage("result")
      queryClient.invalidateQueries({ queryKey: queryKeys.clients.listsAll() })
    } catch {
      toast.error(t("clients.import.errors.confirmFailed"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)} dataCy="clients-import-button">
        <Upload className="h-4 w-4 mr-0 md:mr-2" />
        <span className="hidden md:inline-flex">{t("clients.import.button")}</span>
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-4xl" data-cy="clients-import-dialog">
          <DialogHeader>
            <DialogTitle>{t("clients.import.title")}</DialogTitle>
            <DialogDescription>{t("clients.import.description")}</DialogDescription>
          </DialogHeader>

          {stage === "pick" && (
            <div className="space-y-4">
              <Button
                type="button"
                variant="link"
                className="h-auto p-0"
                onClick={downloadTemplate}
                dataCy="clients-import-template-link"
              >
                <Download className="h-4 w-4 mr-1.5" />
                {t("clients.import.downloadTemplate")}
              </Button>

              <div
                role="button"
                tabIndex={0}
                className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-center"
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault()
                    fileInputRef.current?.click()
                  }
                }}
                data-cy="clients-import-dropzone"
              >
                <FileUp className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
                <p className="text-sm text-muted-foreground">{fileName || t("clients.import.dropHint")}</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  data-cy="clients-import-file-input"
                  onChange={(event) => {
                    const selected = event.target.files?.[0]
                    if (selected) void handleFile(selected)
                  }}
                />
              </div>
            </div>
          )}

          {stage === "preview" && (
            <div className="space-y-4" data-cy="clients-import-preview">
              <div className="flex flex-wrap gap-3 text-sm">
                <Badge variant="secondary" data-cy="clients-import-summary-valid">
                  {t("clients.import.summary.willCreate", { count: willCreate.length })}
                </Badge>
                <Badge variant="warning" data-cy="clients-import-summary-duplicates">
                  {t("clients.import.summary.duplicates", { count: duplicates.length })}
                </Badge>
                <Badge variant="destructive" data-cy="clients-import-summary-rejected">
                  {t("clients.import.summary.rejected", { count: rejected.length })}
                </Badge>
              </div>

              <div className="max-h-96 overflow-y-auto">
                <Table data-cy="clients-import-preview-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="whitespace-nowrap">{t("clients.import.preview.row")}</TableHead>
                      <TableHead className="whitespace-nowrap">{t("clients.import.preview.name")}</TableHead>
                      <TableHead className="whitespace-nowrap">
                        {t("clients.import.preview.status")}
                      </TableHead>
                      <TableHead>{t("clients.import.preview.detail")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.rowNumber} data-cy={`clients-import-row-${row.rowNumber}`}>
                        <TableCell className="tabular-nums align-top">{row.rowNumber}</TableCell>
                        <TableCell className="align-top whitespace-normal break-words">
                          {row.wire.name ||
                            `${row.wire.contactFirstname ?? ""} ${row.wire.contactLastname ?? ""}`.trim()}
                        </TableCell>
                        <TableCell className="align-top">
                          {row.status === "valid" && (
                            <Badge variant="secondary">{t("clients.import.status.valid")}</Badge>
                          )}
                          {row.status === "duplicate" && (
                            <Badge variant="warning">{t("clients.import.status.duplicate")}</Badge>
                          )}
                          {row.status === "rejected" && (
                            <Badge variant="destructive">{t("clients.import.status.rejected")}</Badge>
                          )}
                        </TableCell>
                        {/* `whitespace-normal break-words`, deliberately overriding TableCell's own
                            default `whitespace-nowrap` - the reason IS the point of this table, so it
                            wraps onto as many lines as it needs rather than being clipped at the
                            column edge (see this component's own header for why). */}
                        <TableCell className="whitespace-normal break-words align-top text-sm text-muted-foreground">
                          {row.status === "rejected" && (row.errors ?? []).join("; ")}
                          {row.status === "duplicate" && duplicateDetail(t, row.duplicateOf)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {stage === "result" && result && (
            <div className="space-y-3" data-cy="clients-import-result">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{t("clients.import.result.created")}</span>
                <span className="font-mono tabular-nums font-medium" data-cy="clients-import-result-created">
                  {result.created}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{t("clients.import.result.duplicates")}</span>
                <span
                  className="font-mono tabular-nums font-medium"
                  data-cy="clients-import-result-duplicates"
                >
                  {result.duplicates}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{t("clients.import.result.rejected")}</span>
                <span className="font-mono tabular-nums font-medium" data-cy="clients-import-result-rejected">
                  {result.rejected}
                </span>
              </div>
            </div>
          )}

          <DialogFooter>
            {stage === "preview" && (
              <Button
                type="button"
                onClick={handleConfirm}
                disabled={willCreate.length === 0 || busy || confirmMutation.loading}
                dataCy="clients-import-confirm-button"
              >
                {t("clients.import.confirm", { count: willCreate.length })}
              </Button>
            )}
            {stage === "result" && (
              <Button
                type="button"
                onClick={() => handleOpenChange(false)}
                dataCy="clients-import-close-button"
              >
                {t("common.finish")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
