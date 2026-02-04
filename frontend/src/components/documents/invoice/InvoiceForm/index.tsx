import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useCompany } from '@/contexts/company';
import { useGet, usePatch, usePost } from '@/hooks/use-fetch';
import CurrencySelect from '@/components/currency-select';
import { DatePicker } from '@/components/date-picker';
import SearchSelect from '@/components/search-input';
import { DocumentForm } from '../../DocumentForm';
import type { Client, PaymentMethod, Quote } from '@/types';

interface InvoiceFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice?: any;
  onSuccess?: () => void;
}

export function InvoiceForm({ open, onOpenChange, invoice, onSuccess }: InvoiceFormProps) {
  const { t } = useTranslation();
  const { activeCompany } = useCompany();
  const isEdit = !!invoice;

  const [clientSearchTerm, setClientSearchTerm] = useState('');
  const [quoteSearchTerm, setQuoteSearchTerm] = useState('');

  const { data: clients } = useGet<Client[]>(`/api/clients/search?query=${clientSearchTerm}`);
  const { data: quotes } = useGet<Quote[]>(`/api/quotes/search?query=${quoteSearchTerm}`);
  const { data: paymentMethods } = useGet<PaymentMethod[]>(`/api/payment-methods`);

  const invoiceSchema = z.object({
    quoteId: z.string().optional(),
    clientId: z
      .string()
      .min(1, t('invoices.upsert.form.client.errors.required'))
      .refine((val) => val !== '', {
        message: t('invoices.upsert.form.client.errors.required'),
      }),
    dueDate: z.date().optional(),
    notes: z.string().optional(),
    paymentMethodId: z.string().optional(),
    currency: z.string().optional(),
    items: z.array(
      z.object({
        id: z.string().optional(),
        description: z
          .string()
          .min(1, t('invoices.upsert.form.items.description.errors.required'))
          .refine((val) => val !== '', {
            message: t('invoices.upsert.form.items.description.errors.required'),
          }),
        quantity: z
          .number({
            invalid_type_error: t('invoices.upsert.form.items.quantity.errors.required'),
          })
          .min(1, t('invoices.upsert.form.items.quantity.errors.min'))
          .refine((val) => !Number.isNaN(val), {
            message: t('invoices.upsert.form.items.quantity.errors.invalid'),
          }),
        unitPrice: z
          .number({
            invalid_type_error: t('invoices.upsert.form.items.unitPrice.errors.required'),
          })
          .min(0, t('invoices.upsert.form.items.unitPrice.errors.min'))
          .refine((val) => !Number.isNaN(val), {
            message: t('invoices.upsert.form.items.unitPrice.errors.invalid'),
          }),
        vatRate: z
          .number({
            invalid_type_error: t('invoices.upsert.form.items.vatRate.errors.required'),
          })
          .min(0, t('invoices.upsert.form.items.vatRate.errors.min')),
        type: z.enum(['HOUR', 'DAY', 'DEPOSIT', 'SERVICE', 'PRODUCT']).optional(),
        order: z.number(),
      }),
    ),
  });

  const { trigger: createTrigger } = usePost('/api/invoices');
  const { trigger: updateTrigger } = usePatch(`/api/invoices/${invoice?.id}`);

  const form = useForm<z.infer<typeof invoiceSchema>>({
    resolver: zodResolver(invoiceSchema),
    defaultValues: {
      quoteId: undefined,
      clientId: '',
      dueDate: undefined,
      paymentMethodId: '',
      currency: activeCompany?.currency,
      items: [],
      notes: '',
    },
  });

  useEffect(() => {
    if (isEdit && invoice) {
      form.reset({
        quoteId: invoice.quoteId || '',
        clientId: invoice.clientId || '',
        dueDate: invoice.dueDate ? new Date(invoice.dueDate) : undefined,
        notes: invoice.notes || '',
        paymentMethodId: invoice.paymentMethodId || '',
        currency: invoice.currency || '',
        items: (invoice.items || [])
          .sort((a: any, b: any) => a.order - b.order)
          .map((item: any) => ({
            id: item.id,
            description: item.description || '',
            quantity: item.quantity || 1,
            unitPrice: item.unitPrice || 0,
            vatRate: item.vatRate || 0,
            type: item.type || 'SERVICE',
            order: item.order || 0,
          })),
      });
    } else {
      form.reset({
        quoteId: undefined,
        clientId: '',
        dueDate: undefined,
        notes: '',
        paymentMethodId: '',
        currency: activeCompany?.currency,
        items: [],
      });
    }
  }, [invoice, form, isEdit, activeCompany?.currency]);

  const onSubmit = (data: z.infer<typeof invoiceSchema>) => {
    const trigger = isEdit ? updateTrigger : createTrigger;

    trigger(data)
      .then(() => {
        onOpenChange(false);
        form.reset();
        onSuccess?.();
      })
      .catch((err) => console.error(err));
  };

  const handleQuoteSelect = (val: string) => {
    if (val) {
      const selectedQuote = quotes?.find((q) => q.id === val);
      if (selectedQuote) {
        form.setValue('clientId', selectedQuote.clientId || '');
        form.setValue('notes', selectedQuote.notes || '');
        form.setValue('paymentMethodId', (selectedQuote as any)?.paymentMethodId || '');
        form.setValue('currency', selectedQuote.currency || '');
        form.setValue(
          'items',
          (selectedQuote.items || []).map((item: any, index) => ({
            id: item.id,
            description: item.description || '',
            quantity: item.quantity || 1,
            unitPrice: item.unitPrice || 0,
            vatRate: item.vatRate || 0,
            type: item.type || 'SERVICE',
            order: index,
          })),
        );
      }
    }
  };

  return (
    <DocumentForm
      open={open}
      onOpenChange={onOpenChange}
      documentType="invoice"
      title={t(`invoices.upsert.title.${isEdit ? 'edit' : 'create'}`)}
      submitLabel={t(`invoices.upsert.actions.${isEdit ? 'save' : 'create'}`)}
      defaultValues={form.getValues()}
      onSubmit={onSubmit}
    >
      <div className="space-y-4">
        <div>
          <label className="text-sm font-medium">{t('invoices.upsert.form.quote.label')}</label>
          <SearchSelect
            options={(quotes || []).map((c) => ({
              label: `${c.number}${c.title ? ` (${c.title})` : ''}`,
              value: c.id,
            }))}
            value={form.watch('quoteId') ?? ''}
            onValueChange={handleQuoteSelect}
            onSearchChange={setQuoteSearchTerm}
            placeholder={t('invoices.upsert.form.quote.placeholder')}
          />
        </div>

        <div>
          <label className="text-sm font-medium">{t('invoices.upsert.form.client.label')} *</label>
          <SearchSelect
            options={(clients || []).map((c) => ({
              label: c.name || `${c.contactFirstname} ${c.contactLastname}`,
              value: c.id,
            }))}
            value={form.watch('clientId') ?? ''}
            onValueChange={(val) => form.setValue('clientId', val || null)}
            onSearchChange={setClientSearchTerm}
            placeholder={t('invoices.upsert.form.client.placeholder')}
          />
        </div>

        <div>
          <label className="text-sm font-medium">{t('invoices.upsert.form.currency.label')}</label>
          <CurrencySelect
            value={form.watch('currency')}
            onChange={(value) => form.setValue('currency', value)}
          />
        </div>

        <div>
          <label className="text-sm font-medium">{t('invoices.upsert.form.dueDate.label')}</label>
          <DatePicker
            className="w-full"
            value={form.watch('dueDate') || null}
            onChange={(val) => form.setValue('dueDate', val)}
            placeholder={t('invoices.upsert.form.dueDate.placeholder')}
          />
        </div>

        <div>
          <label className="text-sm font-medium">{t('invoices.upsert.form.paymentMethod.label')}</label>
          <select
            value={form.watch('paymentMethodId') ?? ''}
            onChange={(e) => form.setValue('paymentMethodId', e.target.value)}
            className="w-full px-3 py-2 border rounded-md"
          >
            <option value="">{t('invoices.upsert.form.paymentMethod.placeholder')}</option>
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
