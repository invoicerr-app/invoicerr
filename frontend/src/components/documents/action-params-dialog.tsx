import { zodResolver } from "@hookform/resolvers/zod"
import { useEffect, useMemo } from "react"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"

import { DocumentField } from "@/components/documents/document-field"
import { buildZodSchema, defaultValuesFor } from "@/components/documents/schema"
import type { DocumentActionDescriptor } from "@/components/documents/types"
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

interface ActionParamsDialogProps {
  action: DocumentActionDescriptor
  /** Pre-filled values (see useResolveActionParamsDefaults) — merged under the field defaults, so a
   *  param nobody could pre-fill still gets a sane empty value instead of `undefined`. */
  defaultValues: Record<string, unknown>
  submitting: boolean
  onCancel: () => void
  onConfirm: (params: Record<string, unknown>) => void
}

/**
 * Collects one action's own parameters — declared as `action.params`, the EXACT SAME
 * DocumentFieldDescriptor vocabulary a document's own fields use — before the action runs. Renders
 * them with the exact same DocumentField components as the document form: this is not a second form
 * system, only a second, short-lived react-hook-form instance scoped to the action's own params,
 * which are a different data namespace from the document's `data` (see ActionContext on the backend).
 *
 * Nothing here knows which action or document type it is rendering for — it only ever reads
 * `action.params`, the same way DocumentForm only ever reads `descriptor.fields`.
 */
export function ActionParamsDialog({
  action,
  defaultValues,
  submitting,
  onCancel,
  onConfirm,
}: ActionParamsDialogProps) {
  const { t } = useTranslation()
  // Memoized so an empty `action.params` doesn't hand out a fresh [] every render — that would
  // retrigger the reset effect below on every keystroke and wipe out what the user just typed.
  const params = useMemo(() => action.params ?? [], [action.params])

  const schema = useMemo(() => buildZodSchema(params), [params])
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: { ...defaultValuesFor(params), ...defaultValues },
  })
  const { reset } = form

  // Defaults resolve asynchronously (a network round-trip) and can land after this dialog's first
  // render — react-hook-form only applies `defaultValues` once, at mount, so this re-applies them
  // once they actually arrive. `reset` is react-hook-form's own stable reference, not `form` as a
  // whole, which is what keeps this from re-running (and clobbering user input) on every render.
  useEffect(() => {
    reset({ ...defaultValuesFor(params), ...defaultValues })
  }, [defaultValues, params, reset])

  const handleConfirm = async () => {
    const valid = await form.trigger()
    if (!valid) return
    onConfirm(form.getValues())
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent data-cy="document-action-params-dialog">
        <Form {...form}>
          <DialogHeader>
            <DialogTitle>{t("documents.form.actionParams.title", { label: action.label })}</DialogTitle>
            <DialogDescription>{t("documents.form.actionParams.description")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {params.map((field) => (
              <DocumentField key={field.key} field={field} name={field.key} />
            ))}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel} dataCy="document-action-params-cancel">
              {t("documents.form.actionParams.cancel")}
            </Button>
            <Button
              type="button"
              loading={submitting}
              onClick={handleConfirm}
              dataCy="document-action-params-confirm"
            >
              {t("documents.form.actionParams.confirm")}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
