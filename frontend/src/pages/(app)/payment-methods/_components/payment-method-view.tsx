"use client"

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useTranslation } from "react-i18next";

interface PaymentMethod {
  id: string;
  name: string;
  details?: string;
  type?: "BANK_TRANSFER" | "PAYPAL" | "CASH" | "OTHER";
  isActive?: boolean;
}

export function PaymentMethodViewDialog({
  paymentMethod,
  onOpenChange,
}: {
  paymentMethod?: PaymentMethod | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const open = !!paymentMethod;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{paymentMethod?.name || t("paymentMethods.title")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="text-xs text-muted-foreground">{t("paymentMethods.fields.name.label")}</Label>
            <div className="mt-1 text-foreground">{paymentMethod?.name || "-"}</div>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">{t("paymentMethods.fields.type.label")}</Label>
            <div className="mt-1 text-foreground">
              {(paymentMethod?.type && t(`paymentMethods.fields.type.${paymentMethod.type.toLowerCase()}`)) || paymentMethod?.type || "-"}
            </div>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">{t("paymentMethods.fields.details.label")}</Label>
            <div className="mt-1 text-muted-foreground break-words">{paymentMethod?.details || "-"}</div>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">{t("paymentMethods.fields.status.label")}</Label>
            <div className="mt-1">
              {paymentMethod?.isActive ? (
                <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800">
                  {t("paymentMethods.stats.active") || "Active"}
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-800">
                  {t("paymentMethods.stats.inactive") || "Inactive"}
                </span>
              )}
            </div>
          </div>

          <div className="flex justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t("paymentMethods.actions.cancel") || "Close"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default PaymentMethodViewDialog