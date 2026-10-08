import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Form } from "@/components/ui/form"
import type { FieldValues, UseFormReturn } from "react-hook-form"
import { useTranslation } from "react-i18next"

import { ClientCountryField, ClientTypeAndNameFields } from "./client-core-fields"

interface ClientQuickFormProps {
  readonly form: UseFormReturn<FieldValues>
  readonly open: boolean
  readonly submitting: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onSubmit: () => void
  readonly onOpenFullForm: () => void
}

/** The one-screen client creation a document's client picker opens: type, name and country. The rest
 *  of the record is completed later, and is required before an invoice can be validated. */
export function ClientQuickForm({
  form,
  open,
  submitting,
  onOpenChange,
  onSubmit,
  onOpenFullForm,
}: ClientQuickFormProps) {
  const { t } = useTranslation()
  const clientType = form.watch("type")
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-cy="client-quick-dialog">
        <DialogHeader>
          <DialogTitle>{t("clients.upsert.quick.title")}</DialogTitle>
          <DialogDescription>{t("clients.upsert.quick.description")}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              onSubmit()
            }}
            className="grid gap-4 sm:grid-cols-2"
          >
            <ClientTypeAndNameFields form={form} clientType={clientType} />
            <div className="sm:col-span-2">
              <ClientCountryField form={form} />
            </div>
            <DialogFooter className="items-center sm:col-span-2 sm:justify-between">
              <Button
                type="button"
                variant="link"
                className="px-0"
                onClick={onOpenFullForm}
                dataCy="client-quick-open-full"
              >
                {t("clients.upsert.quick.openFull")}
              </Button>
              <Button type="submit" loading={submitting} dataCy="client-quick-submit">
                {t("clients.upsert.actions.create")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
