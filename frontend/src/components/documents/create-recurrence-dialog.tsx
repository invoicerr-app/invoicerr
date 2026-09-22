import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"

import { DocumentField } from "@/components/documents/document-field"
import { buildZodSchema, defaultValuesFor } from "@/components/documents/schema"
import type { DocumentFieldDescriptor } from "@/components/documents/types"
import { useCreateDocumentSchedule } from "@/hooks/queries"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Form } from "@/components/ui/form"
import { toast } from "sonner"

interface CreateRecurrenceDialogProps {
  typeId: string
  sourceDocumentId: string
  /** Whether "send" is even worth offering as a "then send" option — the type's own descriptor
   *  declares "send" or it doesn't; this dialog never assumes any particular type does. */
  offerThenSend: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Creates a recurrence on the "duplicate" action of one document instance — a dialog GENERIC over
 * document type: it never names "invoice", only reads `typeId`/`sourceDocumentId` from whichever
 * row it was opened from (document-list.tsx). The three fields below (cadence, first occurrence
 * date, "send immediately") are declared as an ordinary `DocumentFieldDescriptor[]`, rendered by the
 * exact same `DocumentField` machinery a document's own form uses — not a second, bespoke input
 * system for this one dialog.
 *
 * `actionId` is always "duplicate": this dialog is only ever offered from
 * document-list.tsx's row actions, gated on the descriptor declaring that action at all — see that
 * file's own `duplicateAction` check.
 */
export function CreateRecurrenceDialog({
  typeId,
  sourceDocumentId,
  offerThenSend,
  open,
  onOpenChange,
}: CreateRecurrenceDialogProps) {
  const { t } = useTranslation()
  const createSchedule = useCreateDocumentSchedule()

  const fields: DocumentFieldDescriptor[] = [
    {
      key: "cadence",
      kind: "select",
      label: t("documents.schedules.dialog.cadence"),
      required: true,
      options: [
        { value: "weekly", label: t("documents.schedules.cadence.weekly") },
        { value: "monthly", label: t("documents.schedules.cadence.monthly") },
        { value: "quarterly", label: t("documents.schedules.cadence.quarterly") },
        { value: "yearly", label: t("documents.schedules.cadence.yearly") },
      ],
    },
    {
      key: "firstOccurrenceAt",
      kind: "date",
      label: t("documents.schedules.dialog.firstOccurrenceAt"),
      required: true,
      helpText: t("documents.schedules.dialog.firstOccurrenceAtHelp"),
    },
    ...(offerThenSend
      ? ([
          {
            key: "thenSend",
            kind: "boolean",
            label: t("documents.schedules.dialog.thenSend"),
            required: false,
            helpText: t("documents.schedules.dialog.thenSendHelp"),
          },
        ] satisfies DocumentFieldDescriptor[])
      : []),
  ]

  const schema = buildZodSchema(fields)
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: { ...defaultValuesFor(fields), cadence: "monthly" },
  })

  const handleClose = (nextOpen: boolean) => {
    if (!nextOpen) form.reset({ ...defaultValuesFor(fields), cadence: "monthly" })
    onOpenChange(nextOpen)
  }

  const handleSubmit = form.handleSubmit(async (values) => {
    try {
      await createSchedule.mutateAsync({
        typeId,
        sourceDocumentId,
        actionId: "duplicate",
        cadence: values.cadence as string,
        firstOccurrenceAt: values.firstOccurrenceAt as string,
        thenSend: offerThenSend ? (values.thenSend as boolean | undefined) : undefined,
      })
      toast.success(t("documents.schedules.dialog.created"))
      handleClose(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("documents.schedules.dialog.createError"))
    }
  })

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent data-cy="create-recurrence-dialog">
        <Form {...form}>
          <DialogHeader>
            <DialogTitle>{t("documents.schedules.dialog.title")}</DialogTitle>
            <DialogDescription>{t("documents.schedules.dialog.description")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {fields.map((field) => (
              <DocumentField key={field.key} field={field} name={field.key} />
            ))}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleClose(false)}
              dataCy="create-recurrence-cancel"
            >
              {t("documents.schedules.dialog.cancel")}
            </Button>
            <Button
              type="button"
              loading={createSchedule.isPending}
              onClick={handleSubmit}
              dataCy="create-recurrence-confirm"
            >
              {t("documents.schedules.dialog.confirm")}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
