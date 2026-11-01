import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { useUpdatePaymentMethod } from "@/hooks/queries"
import type { PaymentMethodConfig } from "@/types/payment-method"

import { PaymentMethodConfigDialog } from "./payment-method-config-dialog"

interface PaymentMethodCardProps {
  method: PaymentMethodConfig
}

/**
 * One registered payment method — the card's own `id` comes straight from the backend's registry
 * (`payment-methods/built-in.ts`), never hard-coded here: this component renders identically whether
 * it is one of today's five or a sixth a plugin adds later, the exact same "the screen never names a
 * method" discipline the document form already holds for a document TYPE.
 *
 * The PREVIEW below the switch — one "<field label>: <value>" line per configured field — is the SAME
 * shape the backend's own `presentFromFields` (payment-methods/types.ts) prints on the invoice PDF and
 * in the covering e-mail, rendered here from the exact same `config`/`fields` this card already has —
 * no second endpoint, and what makes two DIFFERENT methods visibly, honestly different on THIS screen
 * too, not only on a document: cash shows nothing beyond its own label, PayPal shows its e-mail.
 *
 * The switch itself branches on the backend's own `configured` (see `types/payment-method.ts`):
 * turning ON a method that isn't configured yet opens the config dialog instead of a PATCH that would
 * only come back a 400 for a required field with nothing on file — the dialog's `activateOnSave` then
 * saves the config AND flips `enabled` in that one submit. A method already configured, and turning
 * ANY method off, still goes straight through the switch, unchanged.
 */
export function PaymentMethodCard({ method }: PaymentMethodCardProps) {
  const { t } = useTranslation()
  const updateMethod = useUpdatePaymentMethod()
  const [configOpen, setConfigOpen] = useState(false)
  // Which of the two ways to open the dialog this is — see `PaymentMethodConfigDialog`'s own
  // `activateOnSave` header: the plain "Configure" button never touches `enabled`, only the switch
  // reaching for the dialog because the method isn't configured yet does.
  const [activateOnSave, setActivateOnSave] = useState(false)

  const previewLines = method.fields
    .map((field) => {
      const value = method.config[field.key]
      if (value === undefined || value === null || value === "") return null
      return `${field.label}: ${String(value)}`
    })
    .filter((line): line is string => line !== null)

  const openConfigDialog = (activate: boolean) => {
    setActivateOnSave(activate)
    setConfigOpen(true)
  }

  const handleToggle = async (enabled: boolean) => {
    // Turning a method ON while it isn't `configured` yet would 400 on a required field this call
    // has no values for at all — the raw error the owner reported. Route to the config dialog instead
    // of firing a request known in advance to fail; disabling (and turning on an ALREADY configured
    // method) still goes straight through, exactly like today.
    if (enabled && !method.configured) {
      openConfigDialog(true)
      return
    }
    try {
      await updateMethod.mutateAsync({ methodId: method.id, enabled })
      toast.success(t("paymentMethods.messages.updateSuccess"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("paymentMethods.messages.updateError"))
    }
  }

  return (
    <div
      className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6 sm:px-5"
      data-cy={`payment-method-card-${method.id}`}
    >
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-semibold text-foreground">{method.label}</span>
          <Badge
            variant={method.enabled ? "success" : "secondary"}
            data-cy={`payment-method-status-${method.id}`}
          >
            {method.enabled ? t("paymentMethods.enabled") : t("paymentMethods.disabled")}
          </Badge>
        </div>
        {previewLines.length > 0 ? (
          <div
            className="space-y-0.5 text-sm text-muted-foreground"
            data-cy={`payment-method-preview-${method.id}`}
          >
            {previewLines.map((line) => (
              <div key={line} className="break-words">
                {line}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground" data-cy={`payment-method-card-no-fields-${method.id}`}>
            {t("paymentMethods.noFields")}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-4">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => openConfigDialog(false)}
          dataCy={`payment-method-configure-${method.id}`}
        >
          {t("paymentMethods.configure")}
        </Button>
        <Switch
          checked={method.enabled}
          onCheckedChange={handleToggle}
          disabled={updateMethod.isPending}
          aria-label={method.label}
          data-cy={`payment-method-toggle-${method.id}`}
        />
      </div>

      {configOpen && (
        <PaymentMethodConfigDialog
          method={method}
          open={configOpen}
          onOpenChange={setConfigOpen}
          activateOnSave={activateOnSave}
        />
      )}
    </div>
  )
}
