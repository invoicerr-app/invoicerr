import { FilePlus2 } from "lucide-react"
import { useState } from "react"
import { useParams } from "react-router"
import { useTranslation } from "react-i18next"

import { DocumentForm } from "@/components/documents/document-form"
import type { DocumentInstance } from "@/components/documents/types"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useDocumentInstance, useDocumentInstances, useDocumentType } from "@/hooks/queries"
import { usePageHeader } from "@/hooks/use-page-header"

/**
 * The one generic page: fetches a document type's descriptor and renders DocumentForm from it.
 * Nothing here is specific to "quote" or any other type — a plugin adding a document type needs no
 * page of its own, only a registered descriptor (and, on the frontend, a renderer per any new field
 * kind it introduces — see field-renderers/index.ts).
 */
export default function DocumentTypePage() {
  const { t } = useTranslation()
  const { typeId } = useParams()
  const [editingId, setEditingId] = useState<string | undefined>(undefined)

  const { data: descriptor, isLoading, error } = useDocumentType(typeId)
  const { data: instances = [] } = useDocumentInstances(typeId)
  const { data: editingInstance } = useDocumentInstance(typeId, editingId)

  usePageHeader(descriptor?.label ?? typeId)

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto space-y-4 p-6">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (error || !descriptor) {
    return (
      <div className="max-w-4xl mx-auto p-6" data-cy="document-type-unknown">
        {t("documents.form.unknownType", { typeId })}
      </div>
    )
  }

  const formKey = editingId ?? "new"

  return (
    <div className="max-w-4xl mx-auto space-y-8 p-6" data-cy="document-type-page">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">
          {editingId ? t("documents.form.editingTitle", { label: descriptor.label }) : descriptor.label}
        </h2>
        {editingId && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditingId(undefined)}
            dataCy="document-new-button"
          >
            <FilePlus2 className="mr-2 h-4 w-4" />
            {t("documents.form.newButton")}
          </Button>
        )}
      </div>

      <DocumentForm
        key={formKey}
        descriptor={descriptor}
        documentId={editingId}
        initialData={editingId ? editingInstance?.data : undefined}
        status={editingId ? editingInstance?.status : undefined}
        onActionSuccess={(result) => setEditingId(result.id)}
      />

      <div className="space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground">{t("documents.list.title")}</h3>
        {instances.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-cy="document-list-empty">
            {t("documents.list.empty")}
          </p>
        ) : (
          <Table data-cy="document-list-table">
            <TableHeader>
              <TableRow>
                <TableHead>{t("documents.list.columns.status")}</TableHead>
                <TableHead>{t("documents.list.columns.updatedAt")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {instances.map((instance: DocumentInstance) => (
                <TableRow
                  key={instance.id}
                  className="cursor-pointer"
                  onClick={() => setEditingId(instance.id)}
                  data-cy={`document-list-row-${instance.id}`}
                >
                  <TableCell>{instance.status}</TableCell>
                  <TableCell>{new Date(instance.updatedAt).toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  )
}
