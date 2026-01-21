import { Banknote, Edit, Eye, Plus, Trash2 } from 'lucide-react';
import type React from 'react';
import { forwardRef, useImperativeHandle, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PaymentMethodDeleteDialog } from './payment-method-delete';
import { PaymentMethodUpsert } from './payment-method-upsert';
import { PaymentMethodViewDialog } from './payment-method-view';

interface PaymentMethod {
  id: string;
  name: string;
  details?: string;
  type?: 'BANK_TRANSFER' | 'PAYPAL' | 'CASH' | 'OTHER';
  isActive?: boolean;
}

interface PaymentMethodsListProps {
  paymentMethods: PaymentMethod[];
  loading: boolean;
  title: string;
  description: string;
  page?: number;
  pageCount?: number;
  setPage?: (page: number) => void;
  mutate?: () => void;
  emptyState: React.ReactNode;
  showCreateButton?: boolean;
}

export interface PaymentMethodsListHandle {
  handleAddClick: () => void;
}

export const PaymentMethodsList = forwardRef<PaymentMethodsListHandle, PaymentMethodsListProps>(
  (
    {
      paymentMethods = [],
      loading,
      title,
      description,
      mutate,
      emptyState,
      showCreateButton = false,
    },
    ref,
  ) => {
    const { t } = useTranslation();
    const [createDialog, setCreateDialog] = useState<boolean>(false);
    const [editDialog, setEditDialog] = useState<PaymentMethod | null>(null);
    const [viewDialog, setViewDialog] = useState<PaymentMethod | null>(null);
    const [deleteDialog, setDeleteDialog] = useState<PaymentMethod | null>(null);

    useImperativeHandle(ref, () => ({
      handleAddClick() {
        setCreateDialog(true);
      },
    }));

    function handleEdit(pm: PaymentMethod) {
      setEditDialog(pm);
    }

    function handleView(pm: PaymentMethod) {
      setViewDialog(pm);
    }

    function handleDelete(pm: PaymentMethod) {
      setDeleteDialog(pm);
    }

    return (
      <>
        <Card className="gap-0">
          <CardHeader className="border-b flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center space-x-2">
                <Banknote className="h-5 w-5 " />
                <span>{title}</span>
              </CardTitle>
              <CardDescription>{description}</CardDescription>
            </div>
            {showCreateButton && (
              <Button onClick={() => setCreateDialog(true)}>
                <Plus className="h-4 w-4 mr-0 md:mr-2" />
                <span className="hidden md:inline-flex">{t('paymentMethods.list.add')}</span>
              </Button>
            )}
          </CardHeader>

          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-500"></div>
              </div>
            ) : paymentMethods.length === 0 ? (
              emptyState
            ) : (
              <div className="divide-y">
                {paymentMethods.map((pm) => (
                  <div key={pm.id} className="p-4 sm:p-6">
                    <div className="flex flex-row sm:items-center sm:justify-between gap-4">
                      <div className="flex flex-row items-center gap-4 w-full">
                        <div className="p-2 bg-blue-100 rounded-lg mb-4 md:mb-0 w-fit h-fit">
                          <Banknote className="h-5 w-5 text-blue-600" />
                        </div>
                        <div className="flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-medium text-foreground break-words">{pm.name}</h3>
                            <span
                              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                pm.isActive
                                  ? 'bg-green-100 text-green-800'
                                  : 'bg-gray-100 text-gray-800'
                              } w-fit`}
                            >
                              {pm.isActive
                                ? t('clients.stats.active') || 'Active'
                                : t('clients.stats.inactive') || 'Inactive'}
                            </span>
                            <div className="text-sm text-muted-foreground ml-2">
                              {t(`paymentMethods.fields.type.${pm.type?.toLowerCase()}`) || pm.type}
                            </div>
                          </div>
                          <div className="mt-2 text-sm text-muted-foreground">{pm.details}</div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 lg:flex justify-start sm:justify-end gap-1 md:gap-2">
                        <Button
                          tooltip={t('paymentMethods.tooltips.view') || 'View'}
                          variant="ghost"
                          size="icon"
                          onClick={() => handleView(pm)}
                          className="text-gray-600 hover:text-blue-600"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>

                        <Button
                          tooltip={t('paymentMethods.actions.edit')}
                          variant="ghost"
                          size="icon"
                          onClick={() => handleEdit(pm)}
                          className="text-gray-600 hover:text-green-600"
                        >
                          <Edit className="h-4 w-4" />
                        </Button>

                        <Button
                          tooltip={t('paymentMethods.actions.delete')}
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(pm)}
                          className="text-gray-600 hover:text-red-600"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <PaymentMethodUpsert
          open={createDialog}
          onOpenChange={(open: boolean) => {
            setCreateDialog(open);
            if (!open) mutate?.();
          }}
        />

        <PaymentMethodUpsert
          open={!!editDialog}
          paymentMethod={editDialog}
          onOpenChange={(open: boolean) => {
            if (!open) setEditDialog(null);
            mutate?.();
          }}
        />

        <PaymentMethodViewDialog
          paymentMethod={viewDialog}
          onOpenChange={(open: boolean) => (open ? undefined : setViewDialog(null))}
        />

        <PaymentMethodDeleteDialog
          paymentMethod={deleteDialog}
          onOpenChange={(open: boolean) => {
            if (!open) setDeleteDialog(null);
            mutate?.();
          }}
        />
      </>
    );
  },
);

export default PaymentMethodsList;
