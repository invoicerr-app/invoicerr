import { zodResolver } from "@hookform/resolvers/zod"
import { useEffect, useMemo, useState } from "react"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { DocumentField } from "@/components/documents/document-field"
import { buildZodSchema, defaultValuesFor } from "@/components/documents/schema"
import type { DocumentInstance, DocumentTypeDescriptor } from "@/components/documents/types"
import { isActionAvailable } from "@/components/documents/types"
import { Button } from "@/components/ui/button"
import { Form } from "@/components/ui/form"
import { useRunDocumentAction } from "@/hooks/queries"
import { ApiError } from "@/hooks/use-api-query"

interface DocumentFormProps {
  descriptor: DocumentTypeDescriptor
  documentId?: string
  initialData?: Record<string, unknown>
  status?: string
  /** Fires after any action runs successfully — e.g. so a caller can refresh a list or "follow" the
   *  document once it exists (a fresh draft is created on the first save). */
  onActionSuccess?: (result: DocumentInstance, actionId: string) => void
}

/**
 * Renders a document type's ENTIRE form from its descriptor — no code here is specific to any one
 * document type. Add a type by writing a descriptor (backend) with fields the field-renderer
 * registry already covers; this component never changes.
 */
export function DocumentForm({
  descriptor,
  documentId,
  initialData,
  status,
  onActionSuccess,
}: DocumentFormProps) {
  const { t } = useTranslation()
  const [currentDocumentId, setCurrentDocumentId] = useState(documentId)
  const [currentStatus, setCurrentStatus] = useState(status)

  const schema = useMemo(() => buildZodSchema(descriptor.fields), [descriptor])
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: initialData ?? defaultValuesFor(descriptor.fields),
  })

  // The page keys DocumentForm by document id (a "new" vs. an existing one are different mounts),
  // so useState above already seeds currentDocumentId/currentStatus correctly. What a fresh mount
  // can't have yet is the record's DATA: useDocumentInstance resolves after mount, and
  // react-hook-form only applies `defaultValues` once, at mount — this is what re-applies it (and
  // the status that arrives alongside it) once the query actually resolves.
  useEffect(() => {
    if (initialData !== undefined) {
      form.reset(initialData)
    }
    if (status !== undefined) {
      setCurrentStatus(status)
    }
  }, [initialData, status, form])

  const runAction = useRunDocumentAction()

  const handleAction = async (actionId: string) => {
    const valid = await form.trigger()
    if (!valid) {
      toast.error(t("documents.form.messages.invalid"))
      return
    }

    try {
      const result = await runAction.mutateAsync({
        typeId: descriptor.id,
        actionId,
        documentId: currentDocumentId,
        data: form.getValues(),
      })
      setCurrentDocumentId(result.id)
      setCurrentStatus(result.status)
      toast.success(t("documents.form.messages.actionSuccess"))
      onActionSuccess?.(result, actionId)
    } catch (error) {
      // The message IS the point here: a 501 means the action is declared on this document type
      // but nobody registered an implementation for it yet — say exactly that, never fail silently.
      const message = error instanceof ApiError ? error.message : t("documents.form.messages.actionError")
      toast.error(message)
    }
  }

  const availableActions = descriptor.actions.filter((action) => isActionAvailable(action, currentStatus))

  return (
    <Form {...form}>
      <form className="space-y-6" data-cy="document-form" onSubmit={(e) => e.preventDefault()}>
        <div className="space-y-4">
          {descriptor.fields.map((field) => (
            <DocumentField key={field.key} field={field} name={field.key} />
          ))}
        </div>

        <div className="flex flex-wrap gap-2 border-t pt-4">
          {availableActions.map((action) => (
            <Button
              key={action.id}
              type="button"
              variant={action.id === availableActions[0]?.id ? "default" : "outline"}
              loading={runAction.isPending}
              onClick={() => handleAction(action.id)}
              dataCy={`document-action-${action.id}`}
            >
              {action.label}
            </Button>
          ))}
        </div>
      </form>
    </Form>
  )
}
