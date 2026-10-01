import { useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import {
  useClientPaymentMethodRestriction,
  usePaymentMethods,
  useUpdateClientPaymentMethodRestriction,
} from "@/hooks/queries"
import { queryKeys } from "@/lib/query-keys"
import type { Client } from "@/types"

interface ClientPaymentMethodsDialogProps {
  client: Client | null
  onOpenChange: (open: boolean) => void
}

/**
 * Issue #416 ("payment methods per client") - "A client can RESTRICT which of the company's enabled
 * payment methods are offered to them (a subset, never a method the company has not enabled). No
 * restriction set means every company method, exactly as today." On the exact model of
 * `ClientPortalAccessDialog`: a standalone dialog reached from the client row's own "more" menu AND
 * from the client view/edit screens (`client-view.tsx`/`client-upsert.tsx`), never embedded into the
 * create/edit WIZARD itself - a brand-new, not-yet-saved client has no id to restrict yet, the same
 * reason the portal-access entry point only ever appears once editing an EXISTING client.
 *
 * Only the company's own ENABLED methods are offered as checkboxes - restricting a client to a
 * method the company has not turned on yet would do nothing (`persistence.ts#
 * resolveEnabledPaymentMethodPresentations` only ever narrows an ENABLED method), so there is nothing
 * useful to pick from the others. The SWITCH is the "restricted at all" bit: off writes `methodIds:
 * []` (back to unrestricted) regardless of what is checked underneath, on writes exactly the checked
 * subset - the same two-state shape the backend's own `methodIds: []` contract expects.
 */
export function ClientPaymentMethodsDialog({ client, onOpenChange }: ClientPaymentMethodsDialogProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const clientId = client?.id ?? ""
  const { data: companyMethods, isLoading: methodsLoading } = usePaymentMethods()
  const { data: restriction, isLoading: restrictionLoading } = useClientPaymentMethodRestriction(
    clientId,
    !!client,
  )
  const updateRestriction = useUpdateClientPaymentMethodRestriction()

  const enabledMethods = (companyMethods ?? []).filter((method) => method.enabled)

  const [restricted, setRestricted] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // Re-applies the CURRENT server values every time the dialog opens for a (possibly different)
  // client - the same "reset on reopen" need `payment-method-config-dialog.tsx` already documents:
  // this dialog instance is reused across rows, never remounted per client.
  useEffect(() => {
    if (!client || !restriction) return
    setRestricted(restriction.methodIds.length > 0)
    setSelected(new Set(restriction.methodIds))
  }, [client, restriction])

  const toggleMethod = (methodId: string, checked: boolean) => {
    setSelected((previous) => {
      const next = new Set(previous)
      if (checked) next.add(methodId)
      else next.delete(methodId)
      return next
    })
  }

  const noCompanyMethods = !methodsLoading && enabledMethods.length === 0
  // Restricted but nothing picked would save an empty array, which the backend reads back as
  // UNRESTRICTED (see persistence.ts's own header) - silently the opposite of what the switch still
  // shows. Blocked here rather than letting that round-trip surprise happen.
  const emptySelection = restricted && selected.size === 0

  const handleSave = async () => {
    try {
      await updateRestriction.mutateAsync({
        clientId,
        methodIds: restricted ? [...selected] : [],
      })
      // The query key is per-CLIENT, only known from these variables - not something a static
      // `invalidateKeys` on the mutation hook could express, see that hook's own header.
      queryClient.invalidateQueries({ queryKey: queryKeys.paymentMethods.clientRestriction(clientId) })
      toast.success(t("clients.paymentMethods.messages.updateSuccess"))
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("clients.paymentMethods.messages.updateError"))
    }
  }

  return (
    <Dialog open={client != null} onOpenChange={onOpenChange}>
      <DialogContent data-cy="client-payment-methods-dialog">
        <DialogHeader>
          <DialogTitle>{t("clients.paymentMethods.title")}</DialogTitle>
          <DialogDescription>{t("clients.paymentMethods.description")}</DialogDescription>
        </DialogHeader>

        {methodsLoading || restrictionLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : noCompanyMethods ? (
          <p className="text-sm text-muted-foreground" data-cy="client-payment-methods-empty">
            {t("clients.paymentMethods.noCompanyMethods")}
          </p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <div className="space-y-0.5">
                <p className="text-sm font-medium text-foreground">
                  {t("clients.paymentMethods.restrictLabel")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("clients.paymentMethods.restrictDescription")}
                </p>
              </div>
              <Switch
                checked={restricted}
                onCheckedChange={setRestricted}
                data-cy="client-payment-methods-restrict-switch"
              />
            </div>

            {restricted && (
              <ul className="space-y-2" data-cy="client-payment-methods-list">
                {enabledMethods.map((method) => (
                  <li key={method.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`client-payment-method-${method.id}`}
                      checked={selected.has(method.id)}
                      onCheckedChange={(checked) => toggleMethod(method.id, checked === true)}
                      data-cy={`client-payment-method-checkbox-${method.id}`}
                    />
                    <Label
                      htmlFor={`client-payment-method-${method.id}`}
                      className="text-sm font-normal text-foreground"
                    >
                      {method.label}
                    </Label>
                  </li>
                ))}
              </ul>
            )}

            {emptySelection && (
              <p className="text-xs text-destructive" data-cy="client-payment-methods-empty-selection-hint">
                {t("clients.paymentMethods.emptySelectionHint")}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            dataCy="client-payment-methods-cancel"
          >
            {t("clients.paymentMethods.cancel")}
          </Button>
          <Button
            type="button"
            disabled={noCompanyMethods || emptySelection}
            loading={updateRestriction.isPending}
            onClick={handleSave}
            dataCy="client-payment-methods-save"
          >
            {t("clients.paymentMethods.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
