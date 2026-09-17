import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

import { Button } from "@/components/ui/button"

interface ConfirmationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  /** A single fact worth restating right before the irreversible action — a recipient address for a
   *  send, a document number for a signature. Omitted (not an empty row) rather than shown blank when
   *  the caller has nothing to add beyond `description` itself. */
  detailLabel?: string
  detailValue?: string
  confirmLabel: string
  cancelLabel: string
  onConfirm: () => void
  loading?: boolean
  /** `data-cy` root every hook below is derived from (`${dataCy}-cancel` / `${dataCy}-confirm`) — this
   *  ONE dialog now stands between the user and several irreversible actions across the app (sending a
   *  document, signing one…), so a shared, hard-coded hook would collide the moment two screens using
   *  it were both under test. */
  dataCy: string
}

/**
 * A generic "are you sure" modal for an action that cannot be undone once confirmed — Radix's
 * `Dialog` already traps focus inside it and closes on Escape (`onOpenChange(false)`), so neither
 * needs reimplementing here. Deliberately style-neutral (no destructive red by default): most of what
 * this gates is a normal, wanted action a person is simply about to make irreversible (sending a
 * document, signing one) rather than a dangerous one — a caller that DOES want the destructive look
 * passes `variant="destructive"` styling through its own `confirmLabel`/button wrapper if it ever
 * needs to, rather than this component guessing tone from context.
 */
export function ConfirmationDialog({
  open,
  onOpenChange,
  title,
  description,
  detailLabel,
  detailValue,
  confirmLabel,
  cancelLabel,
  onConfirm,
  loading = false,
  dataCy,
}: ConfirmationDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dataCy={dataCy}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {detailValue ? (
          <div className="rounded-md bg-muted p-3 text-sm">
            <span className="font-medium text-muted-foreground">{detailLabel}</span>{" "}
            <span className="font-semibold text-foreground">{detailValue}</span>
          </div>
        ) : null}
        <DialogFooter className="flex !flex-col-reverse gap-2 justify-end">
          <Button
            variant="outline"
            className="w-full bg-transparent"
            onClick={() => onOpenChange(false)}
            disabled={loading}
            dataCy={`${dataCy}-cancel`}
          >
            {cancelLabel}
          </Button>
          <Button
            className="w-full"
            onClick={onConfirm}
            disabled={loading}
            loading={loading}
            dataCy={`${dataCy}-confirm`}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
