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
import type { Client, PaymentMethod } from '@/types';

interface QuoteFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quote?: any;
  onSuccess?: () => void;
}

export function QuoteForm({ open, onOpenChange, quote, onSuccess }: QuoteFormProps) {
  const { t } = useTranslation();
  const { activeCompany } = useCompany();
  const isEdit = !!quote;

  const [clientSearchTerm, setClientSearchTerm] = useState('');

  const { data: clients } = useGet<Client[]>(`/api/clients/search?query=${clientSearchTerm}`);
  const { data: paymentMethods } = useGet<PaymentMethod[]>(`/api/payment-methods`);

  const quoteSchema = z.object({
    clientId: z
      .string()
      .min(1, t('quotes.upsert.form.client.errors.required'))
      .refine((val) => val !== '', {
        message: t('quotes.upsert.form.client.errors.required'),
      }),
    validUntil: z.date().optional(),
    notes: z.string().optional(),
    paymentMethodId: z.string().optional(),
    currency: z.string().optional(),
    items: z.array(
      z.object({
        id: z.string().optional(),
        description: z
          .string()
          .min(1, t('quotes.upsert.form.items.description.errors.required'))
          .refine((val) => val !== '', {
            message: t('quotes.upsert.form.items.description.errors.required'),
          }),
        quantity: z
          .number({
            invalid_type_error: t('quotes.upsert.form.items.quantity.errors.required'),
          })
          .min(1, t('quotes.upsert.form.items.quantity.errors.min'))
          .refine((val) => !Number.isNaN(val), {
            message: t('quotes.upsert.form.items.quantity.errors.invalid'),
          }),
        unitPrice: z
          .number({
            invalid_type_error: t('quotes.upsert.form.items.unitPrice.errors.required'),
          })
          .min(0, t('quotes.upsert.form.items.unitPrice.errors.min'))
          .refine((val) => !Number.isNaN(val), {
            message: t('quotes.upsert.form.items.unitPrice.errors.invalid'),
          }),
        vatRate: z
          .number({
            invalid_type_error: t('quotes.upsert.form.items.vatRate.errors.required'),
          })
          .min(0, t('quotes.upsert.form.items.vatRate.errors.min')),
        type: z.enum(['HOUR', 'DAY', 'DEPOSIT', 'SERVICE', 'PRODUCT']).optional(),
        order: z.number(),
      }),
    ),
  });

  const { trigger: createTrigger } = usePost('/api/quotes');
  const { trigger: updateTrigger } = usePatch(`/api/quotes/${quote?.id}`);

  const form = useForm<z.infer<typeof quoteSchema>>({
    resolver: zodResolver(quoteSchema),
    defaultValues: {
      clientId: '',
      validUntil: undefined,
      paymentMethodId: '',
      currency: activeCompany?.currency,
      items: [],
      notes: '',
    },
  });

  useEffect(() => {
    if (isEdit && quote) {
      form.reset({
        clientId: quote.clientId || '',
        validUntil: quote.validUntil ? new Date(quote.validUntil) : undefined,
        notes: quote.notes || '',
        paymentMethodId: quote.paymentMethodId || '',
        currency: quote.currency || '',
        items: (quote.items || [])
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
        clientId: '',
        validUntil: undefined,
        notes: '',
        paymentMethodId: '',
        currency: activeCompany?.currency,
        items: [],
      });
    }
  }, [quote, form, isEdit, activeCompany?.currency]);

  const onSubmit = (data: z.infer<typeof quoteSchema>) => {
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
      documentType="quote"
      title={t(`quotes.upsert.title.${isEdit ? 'edit' : 'create'}`)}
      submitLabel={t(`quotes.upsert.actions.${isEdit ? 'save' : 'create'}`)}
      defaultValues={form.getValues()}
      onSubmit={onSubmit}
    >
      <div className="space-y-4">
        <div>
          <label className="text-sm font-medium">{t('quotes.upsert.form.client.label')} *</label>
          <SearchSelect
            options={(clients || []).map((c) => ({
              label: c.name || `${c.contactFirstname} ${c.contactLastname}`,
              value: c.id,
            }))}
            value={form.watch('clientId') ?? ''}
            onValueChange={(val) => form.setValue('clientId', val || null)}
            onSearchChange={setClientSearchTerm}
            placeholder={t('quotes.upsert.form.client.placeholder')}
          />
        </div>

        <div>
          <label className="text-sm font-medium">{t('quotes.upsert.form.currency.label')}</label>
          <CurrencySelect
            value={form.watch('currency')}
            onChange={(value) => form.setValue('currency', value)}
          />
        </div>

        <div>
          <label className="text-sm font-medium">{t('quotes.upsert.form.validUntil.label')}</label>
          <DatePicker
            className="w-full"
            value={form.watch('validUntil') || null}
            onChange={(val) => form.setValue('validUntil', val)}
            placeholder={t('quotes.upsert.form.validUntil.placeholder')}
          />
        </div>

        <div>
          <label className="text-sm font-medium">{t('quotes.upsert.form.paymentMethod.label')}</label>
          <select
            value={form.watch('paymentMethodId') ?? ''}
            onChange={(e) => form.setValue('paymentMethodId', e.target.value)}
            className="w-full px-3 py-2 border rounded-md"
          >
            <option value="">{t('quotes.upsert.form.paymentMethod.placeholder')}</option>
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
