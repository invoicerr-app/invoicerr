import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { deriveQuoteOptions } from "@/components/documents/quote-options"
import { useRunDocumentAction } from "@/hooks/queries"
import { ApiError } from "@/hooks/use-api-query"

interface MarkQuoteAcceptedDialogProps {
  documentId: string
  /** The quote's own current `data`, unedited - the same "act on the record's own saved data, no
   *  live form involved" shape `document-list.tsx`'s row actions already use for a saved instance
   *  (the backend's "accept-manually" handler never touches `data` at all - see
   *  `actions/quote-manual-acceptance.ts`'s own header - this is only here because `runAction`'s own
   *  request body always carries `data`). */
  data: Record<string, unknown>
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * A BESPOKE dialog for the quote's "accept-manually" action (issue #421) - deliberately NOT the
 * generic `ActionParamsDialog` every other action-with-params uses (action-params-dialog.tsx). Two
 * reasons, both real:
 *  - the note must be REQUIRED and NON-EMPTY, which the generic dialog cannot enforce (its 'longText'
 *    zod schema only checks the value IS a string, not that it carries anything - schema.ts's own
 *    `baseSchemaFor`, shared by every text-ish field in this app, and changing it there would loosen
 *    or tighten every OTHER action's/field's own text validation along with it);
 *  - the confirmation must carry an explicit, un-genericizable WARNING that this is not an electronic
 *    signature - the generic dialog's copy is deliberately the same one line for every action.
 * Same pattern `share-link-dialog.tsx` already establishes for "share-link": a status/policy-gated
 * action, excluded from the generic action list (`use-document-form.ts`), given its own door instead.
 *
 * Issue #373 ("quotes with options") adds a THIRD, conditional reason this stays bespoke: a required
 * option selector that only appears when `data` itself carries 2+ options
 * (`deriveQuoteOptions`) - the generic dialog has no concept of "required only sometimes, depending on
 * the record's own data".
 *
 * Adopts NO result itself: `useRunDocumentAction`'s own `invalidateKeys: [["documents"]]` (see that
 * hook's own header) refetches the detail page's `useDocumentInstance` query (keyed the same way) and
 * `document-acceptance-section.tsx`'s own `useDocumentManualAcceptance` query, so the new "accepted"
 * status and the freshly-archived manifest both reach the screen through the SAME cache-invalidation
 * path every other action on this page already relies on - no separate plumbing needed here.
 */
export function MarkQuoteAcceptedDialog({
  documentId,
  data,
  open,
  onOpenChange,
}: MarkQuoteAcceptedDialogProps) {
  const { t } = useTranslation()
  const [note, setNote] = useState("")
  const [touched, setTouched] = useState(false)
  const [option, setOption] = useState<string | undefined>(undefined)
  const [optionTouched, setOptionTouched] = useState(false)
  const runAction = useRunDocumentAction()

  // Issue #373 ("quotes with options") - the quote's own 2+ options, derived off the SAME `data` the
  // detail page already reads (see `deriveQuoteOptions`'s own header: distinct, non-empty, in
  // first-appearance order). Fewer than two: this dialog behaves exactly as it did before this
  // feature existed - no selector, no new required input.
  const options = useMemo(() => {
    const lines = Array.isArray(data.lines) ? (data.lines as Record<string, unknown>[]) : []
    return deriveQuoteOptions(lines)
  }, [data])
  const needsOption = options.length >= 2

  const trimmed = note.trim()
  const isEmpty = trimmed.length === 0
  const showError = touched && isEmpty
  const showOptionError = optionTouched && needsOption && !option

  const handleClose = (nextOpen: boolean) => {
    if (!nextOpen) {
      setNote("")
      setTouched(false)
      setOption(undefined)
      setOptionTouched(false)
    }
    onOpenChange(nextOpen)
  }

  const handleConfirm = async () => {
    setTouched(true)
    setOptionTouched(true)
    if (isEmpty || (needsOption && !option)) return

    try {
      const result = await runAction.mutateAsync({
        typeId: "quote",
        actionId: "accept-manually",
        documentId,
        data,
        params: { note: trimmed, ...(option ? { option } : {}) },
      })
      toast.success(result.message ?? t("documents.acceptance.confirmedToast"))
      handleClose(false)
    } catch (error) {
      const message = error instanceof ApiError ? error.message : t("documents.form.messages.actionError")
      toast.error(message)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent data-cy="mark-quote-accepted-dialog">
        <DialogHeader>
          <DialogTitle>{t("documents.acceptance.dialogTitle")}</DialogTitle>
          <DialogDescription>{t("documents.acceptance.dialogDescription")}</DialogDescription>
        </DialogHeader>

        <Alert variant="warning" data-cy="mark-quote-accepted-warning">
          <AlertDescription>{t("documents.acceptance.dialogWarning")}</AlertDescription>
        </Alert>

        {needsOption && (
          <div className="space-y-2 py-2">
            <Label htmlFor="mark-quote-accepted-option">{t("documents.acceptance.optionLabel")}</Label>
            <Select
              value={option}
              onValueChange={(value) => {
                setOption(value)
                setOptionTouched(true)
              }}
            >
              <SelectTrigger
                id="mark-quote-accepted-option"
                aria-invalid={showOptionError}
                data-cy="mark-quote-accepted-option"
              >
                <SelectValue placeholder={t("documents.acceptance.optionPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {options.map((opt) => (
                  <SelectItem key={opt} value={opt} data-cy="mark-quote-accepted-option-item">
                    {opt}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {showOptionError && (
              <p className="text-sm text-destructive" data-cy="mark-quote-accepted-option-error">
                {t("documents.acceptance.optionRequired")}
              </p>
            )}
          </div>
        )}

        <div className="space-y-2 py-2">
          <Label htmlFor="mark-quote-accepted-note">{t("documents.acceptance.noteLabel")}</Label>
          <Textarea
            id="mark-quote-accepted-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            onBlur={() => setTouched(true)}
            placeholder={t("documents.acceptance.notePlaceholder")}
            aria-invalid={showError}
            data-cy="mark-quote-accepted-note"
          />
          {showError && (
            <p className="text-sm text-destructive" data-cy="mark-quote-accepted-note-error">
              {t("documents.acceptance.noteRequired")}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleClose(false)}
            dataCy="mark-quote-accepted-cancel"
          >
            {t("documents.acceptance.cancel")}
          </Button>
          <Button
            type="button"
            loading={runAction.isPending}
            onClick={handleConfirm}
            dataCy="mark-quote-accepted-confirm"
          >
            {t("documents.acceptance.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
