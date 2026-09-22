import { zodResolver } from "@hookform/resolvers/zod"
import { useEffect, useMemo } from "react"
import { useForm } from "react-hook-form"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { DocumentField } from "@/components/documents/document-field"
import { buildZodSchema, defaultValuesFor } from "@/components/documents/schema"
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
import { useUpdatePaymentMethod } from "@/hooks/queries"
import type { PaymentMethodConfig } from "@/types/payment-method"

interface PaymentMethodConfigDialogProps {
  method: PaymentMethodConfig
  open: boolean
  onOpenChange: (open: boolean) => void
  /** True only when the card's own Switch opened this dialog because the method wasn't `configured`
   *  yet (payment-method-card.tsx#handleToggle) — turning the raw "flip the switch, get a 400" defect
   *  into "fill in what's missing, then activate", in the one action a dialog's Save already is. False
   *  for the plain "Configure" button, which still only ever touches `config` — see this component's
   *  own header below. */
  activateOnSave?: boolean
}

/**
 * The config form for ONE payment method — reuses the EXACT SAME `DocumentField` components, zod
 * schema builder and defaults resolver the document action-params dialog already uses
 * (action-params-dialog.tsx), over `method.fields` instead of an action's own `params`: the identical
 * field vocabulary, a different namespace. A method with an EMPTY `fields` array (cash, Stripe) opens
 * an empty form — no invented "nothing to configure" placeholder needed, proving the empty case is a
 * real, working one rather than a special-cased dead end.
 *
 * Saves `config` alone by default: the card's own Switch (payment-method-card.tsx) is the one place
 * `enabled` is normally written, so filling in a method's details never silently starts offering it.
 * The ONE exception is `activateOnSave` — the switch, finding the method not yet `configured`, opens
 * THIS dialog instead of PATCHing straight to a guaranteed 400; saving it then both fills in the
 * fields and flips `enabled: true`, in the single PATCH the brief asks for, rather than requiring a
 * second click on a switch the user already just clicked.
 */
export function PaymentMethodConfigDialog({
  method,
  open,
  onOpenChange,
  activateOnSave = false,
}: PaymentMethodConfigDialogProps) {
  const { t } = useTranslation()
  const updateMethod = useUpdatePaymentMethod()

  const fields = useMemo(() => method.fields, [method.fields])
  const schema = useMemo(() => buildZodSchema(fields), [fields])
  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: { ...defaultValuesFor(fields), ...method.config },
  })
  const { reset } = form

  // Re-applies the CURRENT server values every time the dialog opens — react-hook-form only honors
  // `defaultValues` at mount, and this dialog is a single, reused instance per card (never remounted),
  // so a re-open after an earlier edit must not keep showing what was typed (or left un-saved) last
  // time — the same "reset on reopen" need `document-upsert-dialog.tsx`-family components already hold.
  useEffect(() => {
    if (open) reset({ ...defaultValuesFor(fields), ...method.config })
  }, [open, fields, method.config, reset])

  const onSubmit = async (values: Record<string, unknown>) => {
    try {
      await updateMethod.mutateAsync({
        methodId: method.id,
        config: values,
        ...(activateOnSave ? { enabled: true } : {}),
      })
      toast.success(t("paymentMethods.messages.updateSuccess"))
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("paymentMethods.messages.updateError"))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-cy="payment-method-config-dialog">
        <Form {...form}>
          <DialogHeader>
            <DialogTitle>{t("paymentMethods.dialog.title", { label: method.label })}</DialogTitle>
            <DialogDescription>
              {activateOnSave
                ? t("paymentMethods.dialog.descriptionActivate")
                : t("paymentMethods.dialog.description")}
            </DialogDescription>
          </DialogHeader>

          {fields.length === 0 ? (
            <p
              className="py-2 text-sm text-muted-foreground"
              data-cy={`payment-method-no-fields-${method.id}`}
            >
              {t("paymentMethods.noFields")}
            </p>
          ) : (
            <div className="space-y-4 py-2">
              {fields.map((field) => (
                <DocumentField key={field.key} field={field} name={field.key} />
              ))}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              dataCy="payment-method-config-cancel"
            >
              {t("paymentMethods.dialog.cancel")}
            </Button>
            <Button
              type="button"
              loading={updateMethod.isPending}
              onClick={form.handleSubmit(onSubmit)}
              dataCy="payment-method-config-save"
            >
              {t("paymentMethods.dialog.save")}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
