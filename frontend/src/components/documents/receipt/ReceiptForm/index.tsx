import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useGet, usePatch, usePost } from '@/hooks/use-fetch';
import { DocumentForm } from '../../DocumentForm';
import SearchSelect from '@/components/search-input';
import type { PaymentMethod } from '@/types';

interface ReceiptFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  receipt?: any;
  invoiceId?: string;
  onSuccess?: () => void;
}

export function ReceiptForm({ open, onOpenChange, receipt, invoiceId, onSuccess }: ReceiptFormProps) {
  const { t } = useTranslation();
  const isEdit = !!receipt;

  const [invoiceSearchTerm, setInvoiceSearchTerm] = useState('');

  const { data: invoices } = useGet<any[]>(`/api/invoices/search?query=${invoiceSearchTerm}`);
  const { data: paymentMethods } = useGet<PaymentMethod[]>(`/api/payment-methods`);

  const receiptSchema = z.object({
    invoiceId: z.string().min(1, 'Invoice is required'),
    paymentMethodId: z.string().optional(),
    items: z.array(
      z.object({
        invoiceItemId: z.string(),
        amountPaid: z.number().min(0, 'Amount must be positive'),
      }),
    ),
  });

  const { trigger: createTrigger } = usePost('/api/receipts');
  const { trigger: updateTrigger } = usePatch(`/api/receipts/${receipt?.id}`);

  const form = useForm<z.infer<typeof receiptSchema>>({
    resolver: zodResolver(receiptSchema),
    defaultValues: {
      invoiceId: invoiceId || '',
      paymentMethodId: '',
      items: [],
    },
  });

  useEffect(() => {
    if (isEdit && receipt) {
      form.reset({
        invoiceId: receipt.invoiceId || '',
        paymentMethodId: receipt.paymentMethodId || '',
        items: (receipt.items || []).map((item: any) => ({
          invoiceItemId: item.invoiceItemId,
          amountPaid: item.amountPaid,
        })),
      });
    } else if (invoiceId) {
      form.reset({
        invoiceId,
        paymentMethodId: '',
        items: [],
      });
    }
  }, [receipt, form, isEdit, invoiceId]);

  const onSubmit = (data: z.infer<typeof receiptSchema>) => {
    const trigger = isEdit ? updateTrigger : createTrigger;

    trigger(data)
      .then(() => {
        onOpenChange(false);
        form.reset();
        onSuccess?.();
      })
      .catch((err) => console.error(err));
  };

  return (
    <DocumentForm
      open={open}
      onOpenChange={onOpenChange}
      title={t(`receipts.upsert.title.${isEdit ? 'edit' : 'create'}`)}
      submitLabel={t(`receipts.upsert.actions.${isEdit ? 'save' : 'create'}`)}
      defaultValues={form.getValues()}
      onSubmit={onSubmit}
    >
      <div className="space-y-4">
        <div>
           <label className="text-sm font-medium">{t('receipts.upsert.form.invoice.label')} *</label>
           <SearchSelect
             options={(invoices || []).map((inv) => ({
               label: `${inv.rawNumber || inv.number}${inv.title ? ` (${inv.title})` : ''}`,
               value: inv.id,
             }))}
             value={form.watch('invoiceId') ?? ''}
             onValueChange={(val) => form.setValue('invoiceId', (val as string) || '')}
             onSearchChange={setInvoiceSearchTerm}
             placeholder={t('receipts.upsert.form.invoice.placeholder')}
           />
        </div>

        <div>
          <label className="text-sm font-medium">{t('receipts.upsert.form.paymentMethod.label')}</label>
          <select
            value={form.watch('paymentMethodId') ?? ''}
            onChange={(e) => form.setValue('paymentMethodId', e.target.value)}
            className="w-full px-3 py-2 border rounded-md"
          >
            <option value="">{t('receipts.upsert.form.paymentMethod.placeholder')}</option>
            {(paymentMethods || []).map((pm: PaymentMethod) => (
              <option key={pm.id} value={pm.id}>
                {pm.name}
              </option>
            ))}
          </select>
        </div>
      </div>
    </DocumentForm>
  );
}
