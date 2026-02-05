"use client"

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

import { Button } from "@/components/ui/button";
import { authenticatedFetch } from "@/hooks/use-fetch";
import { toast } from "sonner";
import { useState } from "react";
import { useTranslation } from "react-i18next";

interface PaymentMethod {
  id: string;
  name: string;
  details?: string;
  type?: "BANK_TRANSFER" | "PAYPAL" | "CASH" | "OTHER";
  isActive?: boolean;
}

export function PaymentMethodDeleteDialog({
  paymentMethod,
  onOpenChange,
}: {
  paymentMethod?: PaymentMethod | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const open = !!paymentMethod;

  const handleDelete = async () => {
    if (!paymentMethod) return;
    setLoading(true);
    try {
      const res = await authenticatedFetch(`${import.meta.env.VITE_BACKEND_URL || ""}/api/payment-methods/${paymentMethod.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Delete failed");
      toast.success(t("paymentMethods.upsert.messages.deleteSuccess") || "Payment method deleted");
      onOpenChange(false);
    } catch (err) {
      console.error(err);
      toast.error(t("paymentMethods.upsert.messages.deleteError") || "Failed to delete payment method");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {paymentMethod?.name ? `${t("paymentMethods.actions.delete") || "Delete"} ${paymentMethod.name}` : t("paymentMethods.actions.delete") || "Delete payment method"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t("paymentMethods.delete.description", { name: paymentMethod?.name }) || `Are you sure you want to delete "${paymentMethod?.name}"? This action cannot be undone.`}
          </p>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
              {t("paymentMethods.actions.cancel") || "Cancel"}
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={loading}>
              {loading ? t("paymentMethods.actions.deleting") || "Deleting..." : t("paymentMethods.actions.delete") || "Delete"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default PaymentMethodDeleteDialog