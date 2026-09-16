import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
 */
export function PaymentMethodCard({ method }: PaymentMethodCardProps) {
  const { t } = useTranslation()
  const updateMethod = useUpdatePaymentMethod()
  const [configOpen, setConfigOpen] = useState(false)

  const previewLines = method.fields
    .map((field) => {
      const value = method.config[field.key]
      if (value === undefined || value === null || value === "") return null
      return `${field.label}: ${String(value)}`
    })
    .filter((line): line is string => line !== null)

  const handleToggle = async (enabled: boolean) => {
    try {
      await updateMethod.mutateAsync({ methodId: method.id, enabled })
      toast.success(t("paymentMethods.messages.updateSuccess"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("paymentMethods.messages.updateError"))
    }
  }

  return (
    <Card data-cy={`payment-method-card-${method.id}`}>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2">
          {method.label}
          <Badge
            variant={method.enabled ? "success" : "secondary"}
            data-cy={`payment-method-status-${method.id}`}
          >
            {method.enabled ? t("paymentMethods.enabled") : t("paymentMethods.disabled")}
          </Badge>
        </CardTitle>
        <Switch
          checked={method.enabled}
          onCheckedChange={handleToggle}
          disabled={updateMethod.isPending}
          data-cy={`payment-method-toggle-${method.id}`}
        />
      </CardHeader>
      <CardContent className="space-y-3">
        {previewLines.length > 0 ? (
          <div
            className="space-y-1 text-sm text-muted-foreground"
            data-cy={`payment-method-preview-${method.id}`}
          >
            {previewLines.map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground" data-cy={`payment-method-card-no-fields-${method.id}`}>
            {t("paymentMethods.noFields")}
          </p>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setConfigOpen(true)}
          dataCy={`payment-method-configure-${method.id}`}
        >
          {t("paymentMethods.configure")}
        </Button>
      </CardContent>

      {configOpen && (
        <PaymentMethodConfigDialog method={method} open={configOpen} onOpenChange={setConfigOpen} />
      )}
    </Card>
  )
}
