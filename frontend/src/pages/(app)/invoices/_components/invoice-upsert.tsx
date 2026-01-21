import {
  closestCenter,
  DndContext,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { zodResolver } from '@hookform/resolvers/zod';
import { GripVertical, Plus, Trash2 } from 'lucide-react';
import type React from 'react';
import { useEffect, useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { BetterInput } from '@/components/better-input';
import CurrencySelect from '@/components/currency-select';
import { DatePicker } from '@/components/date-picker';
import SearchSelect from '@/components/search-input';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useGet, usePatch, usePost } from '@/hooks/use-fetch';
import type { Client, Invoice, PaymentMethod, Quote } from '@/types';
import { PaymentMethodType } from '@/types';
import { ClientUpsert } from '../../clients/_components/client-upsert';

interface InvoiceUpsertDialogProps {
  invoice?: Invoice | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function InvoiceUpsert({ invoice, open, onOpenChange }: InvoiceUpsertDialogProps) {
  const { t } = useTranslation();
  const isEdit = !!invoice;

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
          .refine((val) => !isNaN(val), {
            message: t('invoices.upsert.form.items.quantity.errors.invalid'),
          }),
        unitPrice: z
          .number({
            invalid_type_error: t('invoices.upsert.form.items.unitPrice.errors.required'),
          })
          .min(0, t('invoices.upsert.form.items.unitPrice.errors.min'))
          .refine((val) => !isNaN(val), {
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

  const [clientSearchTerm, setClientsSearchTerm] = useState('');
  const [quoteSearchTerm, setQuoteSearchTerm] = useState('');
  const [clientDialogOpen, setClientDialogOpen] = useState(false);
  const { data: clients } = useGet<Client[]>(`/api/clients/search?query=${clientSearchTerm}`);
  const { data: quotes } = useGet<Quote[]>(`/api/quotes/search?query=${quoteSearchTerm}`);
  const { data: paymentMethods } = useGet<PaymentMethod[]>(`/api/payment-methods`);

  const { trigger: createTrigger } = usePost('/api/invoices');
  const { trigger: updateTrigger } = usePatch(`/api/invoices/${invoice?.id}`);

  const form = useForm<z.infer<typeof invoiceSchema>>({
    resolver: zodResolver(invoiceSchema),
    defaultValues: {
      quoteId: undefined,
      clientId: '',
      dueDate: undefined,
      paymentMethodId: '',
      currency: undefined,
      items: [],
      notes: '',
    },
  });

  useEffect(() => {
    if (isEdit && invoice) {
      const inv: any = invoice as any;
      form.reset({
        quoteId: inv.quoteId || '',
        clientId: inv.clientId || '',
        dueDate: inv.dueDate ? new Date(inv.dueDate) : undefined,
        notes: inv.notes || '',
        paymentMethodId: inv.paymentMethodId || '',
        currency: inv.currency || '',
        items: (inv.items || [])
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
        currency: undefined,
        items: [],
      });
    }
  }, [invoice, form, isEdit]);

  const { control, handleSubmit, setValue } = form;
  const { fields, append, move, remove } = useFieldArray({
    control,
    name: 'items',
  });

  const sensors = useSensors(useSensor(MouseSensor), useSensor(TouchSensor));

  const onDragEnd = (event: any) => {
    const { active, over } = event;
    if (active.id !== over?.id) {
      const oldIndex = fields.findIndex((f) => f.id === active.id);
      const newIndex = fields.findIndex((f) => f.id === over.id);
      move(oldIndex, newIndex);
      const reordered = arrayMove(fields, oldIndex, newIndex);
      reordered.forEach((_, index) => {
        setValue(`items.${index}.order`, index);
      });
    }
  };

  useEffect(() => {
    fields.forEach((_, i) => {
      setValue(`items.${i}.order`, i);
    });
  }, [fields, setValue]);

  const onRemove = (index: number) => {
    remove(index);
  };

  const onSubmit = (data: z.infer<typeof invoiceSchema>) => {
    console.debug('Submitting invoice data:', data);

    const trigger = isEdit ? updateTrigger : createTrigger;

    trigger(data)
      .then(() => {
        onOpenChange(false);
        form.reset();
      })
      .catch((err) => console.error(err));
  };

  const handleClientCreate = (newClient: Client) => {
    setClientsSearchTerm('');
    form.setValue('clientId', newClient.id);
    clients?.push(newClient);
    form.trigger('clientId');
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-sm lg:max-w-4xl" dataCy="invoice-dialog">
          <DialogHeader>
            <DialogTitle>{t(`invoices.upsert.title.${isEdit ? 'edit' : 'create'}`)}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" data-cy="invoice-form">
              <FormField
                control={control}
                name="quoteId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('invoices.upsert.form.quote.label')}</FormLabel>
                    <FormControl>
                      <SearchSelect
                        options={(quotes || []).map((c) => ({
                          label: `${c.number}${c.title ? ` (${c.title})` : ''}`,
                          value: c.id,
                        }))}
                        value={field.value ?? ''}
                        onValueChange={(val) => {
                          field.onChange(val || null);
                          if (val) {
                            const selectedQuote = quotes?.find((q) => q.id === val);
                            form.setValue('clientId', selectedQuote?.clientId || '');
                            form.setValue('notes', selectedQuote?.notes || '');
                            form.setValue(
                              'paymentMethodId',
                              (selectedQuote as any)?.paymentMethodId || '',
                            );
                            form.setValue('currency', selectedQuote?.currency || '');
                            form.setValue(
                              'items',
                              (selectedQuote?.items || []).map((item: any, index) => ({
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
                        }}
                        onSearchChange={setQuoteSearchTerm}
                        placeholder={t('invoices.upsert.form.quote.placeholder')}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={control}
                name="clientId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>{t('invoices.upsert.form.client.label')}</FormLabel>
                    <FormControl>
                      <SearchSelect
                        options={(clients || []).map((c) => ({
                          label: c.name || c.contactFirstname + ' ' + c.contactLastname,
                          value: c.id,
                        }))}
                        value={field.value ?? ''}
                        onValueChange={(val) => field.onChange(val || null)}
                        onSearchChange={setClientsSearchTerm}
                        placeholder={t('invoices.upsert.form.client.placeholder')}
                        data-cy="invoice-client-select"
                        noResultsComponent={
                          <Button variant="link" onClick={() => setClientDialogOpen(true)}>
                            {t('invoices.upsert.form.client.noOptions')}
                          </Button>
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="currency"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('invoices.upsert.form.currency.label')}</FormLabel>
                    <FormControl>
                      <CurrencySelect
                        value={field.value}
                        onChange={(value) => field.onChange(value)}
                        data-cy="invoice-currency-select"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={control}
                name="dueDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('invoices.upsert.form.dueDate.label')}</FormLabel>
                    <FormControl>
                      <DatePicker
                        className="w-full"
                        value={field.value || null}
                        onChange={field.onChange}
                        placeholder={t('invoices.upsert.form.dueDate.placeholder')}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('invoices.upsert.form.notes.label')}</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        placeholder={t('invoices.upsert.form.notes.placeholder')}
                        className="max-h-40"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={control}
                name="paymentMethodId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('invoices.upsert.form.paymentMethod.label')}</FormLabel>
                    <FormControl>
                      <Select
                        value={field.value ?? ''}
                        onValueChange={(val) => {
                          const v = val || '';
                          field.onChange(v);
                        }}
                      >
                        <SelectTrigger
                          className="w-full"
                          aria-label={t('invoices.upsert.form.paymentMethod.label') as string}
                        >
                          <SelectValue
                            placeholder={t('invoices.upsert.form.paymentMethod.placeholder')}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {(paymentMethods || []).map((pm: PaymentMethod) => (
                            <SelectItem key={pm.id} value={pm.id}>
                              {pm.name} -{' '}
                              {pm.type == PaymentMethodType.BANK_TRANSFER
                                ? t('paymentMethods.fields.type.bank_transfer')
                                : pm.type == PaymentMethodType.PAYPAL
                                  ? t('paymentMethods.fields.type.paypal')
                                  : pm.type == PaymentMethodType.CHECK
                                    ? t('paymentMethods.fields.type.check')
                                    : pm.type == PaymentMethodType.CASH
                                      ? t('paymentMethods.fields.type.cash')
                                      : pm.type == PaymentMethodType.OTHER
                                        ? t('paymentMethods.fields.type.other')
                                        : pm.type}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormDescription>
                      {t('invoices.upsert.form.paymentMethod.description')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormItem>
                <FormLabel>{t('invoices.upsert.form.items.label')}</FormLabel>
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={onDragEnd}
                >
                  <SortableContext
                    items={fields.map((f) => f.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="space-y-2">
                      {fields.map((fieldItem, index) => (
                        <SortableItem
                          key={fieldItem.id}
                          id={fieldItem.id}
                          dragHandle={
                            <GripVertical className="cursor-grab text-muted-foreground" />
                          }
                        >
                          <div className="flex gap-2 items-center">
                            <FormField
                              control={control}
                              name={`items.${index}.description`}
                              render={({ field }) => (
                                <FormItem>
                                  <FormControl>
                                    <Input
                                      {...field}
                                      placeholder={t(
                                        `invoices.upsert.form.items.description.placeholder`,
                                      )}
                                    />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />

                            <FormField
                              control={control}
                              name={`items.${index}.type`}
                              render={({ field }) => (
                                <FormItem>
                                  <FormControl>
                                    <Select
                                      value={field.value ?? 'SERVICE'}
                                      onValueChange={(val) => field.onChange(val as any)}
                                    >
                                      <SelectTrigger
                                        className="w-32 mb-0"
                                        aria-label={
                                          t('invoices.upsert.form.items.type.label') as string
                                        }
                                      >
                                        <SelectValue />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="HOUR">
                                          {t('invoices.upsert.form.items.type.hour')}
                                        </SelectItem>
                                        <SelectItem value="DAY">
                                          {t('invoices.upsert.form.items.type.day')}
                                        </SelectItem>
                                        <SelectItem value="DEPOSIT">
                                          {t('invoices.upsert.form.items.type.deposit')}
                                        </SelectItem>
                                        <SelectItem value="SERVICE">
                                          {t('invoices.upsert.form.items.type.service')}
                                        </SelectItem>
                                        <SelectItem value="PRODUCT">
                                          {t('invoices.upsert.form.items.type.product')}
                                        </SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />

                            <FormField
                              control={control}
                              name={`items.${index}.quantity`}
                              render={({ field }) => (
                                <FormItem>
                                  <FormControl>
                                    <BetterInput
                                      {...field}
                                      defaultValue={field.value || ''}
                                      postAdornment={t(`invoices.upsert.form.items.quantity.unit`)}
                                      type="number"
                                      placeholder={t(
                                        `invoices.upsert.form.items.quantity.placeholder`,
                                      )}
                                      onChange={(e) =>
                                        field.onChange(
                                          e.target.value === ''
                                            ? undefined
                                            : Number(e.target.value),
                                        )
                                      }
                                    />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />

                            <FormField
                              control={control}
                              name={`items.${index}.unitPrice`}
                              render={({ field }) => (
                                <FormItem>
                                  <FormControl>
                                    <BetterInput
                                      {...field}
                                      defaultValue={field.value || ''}
                                      postAdornment="$"
                                      type="number"
                                      placeholder={t(
                                        `invoices.upsert.form.items.unitPrice.placeholder`,
                                      )}
                                      onChange={(e) =>
                                        field.onChange(
                                          e.target.value === ''
                                            ? undefined
                                            : Number(e.target.value),
                                        )
                                      }
                                    />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />

                            <FormField
                              control={control}
                              name={`items.${index}.vatRate`}
                              render={({ field }) => (
                                <FormItem>
                                  <FormControl>
                                    <BetterInput
                                      {...field}
                                      defaultValue={field.value || 0}
                                      postAdornment="%"
                                      type="number"
                                      step="0.01"
                                      placeholder={t(
                                        `invoices.upsert.form.items.vatRate.placeholder`,
                                      )}
                                      onChange={(e) =>
                                        field.onChange(
                                          e.target.value === ''
                                            ? undefined
                                            : Number.parseFloat(e.target.value.replace(',', '.')),
                                        )
                                      }
                                    />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />

                            <Button variant={'outline'} onClick={() => onRemove(index)}>
                              <Trash2 className="h-4 w-4 text-red-700" />
                            </Button>
                          </div>
                        </SortableItem>
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>

                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    append({
                      description: '',
                      quantity: Number.NaN,
                      unitPrice: Number.NaN,
                      vatRate: Number.NaN,
                      type: 'SERVICE',
                      order: fields.length,
                    })
                  }
                >
                  <Plus className="mr-2 h-4 w-4" />
                  {t('invoices.upsert.form.items.addItem')}
                </Button>
              </FormItem>

              <div className="flex justify-end space-x-2">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  {t('invoices.upsert.actions.cancel')}
                </Button>
                <Button type="submit" dataCy="invoice-submit">
                  {t(`invoices.upsert.actions.${isEdit ? 'save' : 'create'}`)}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <ClientUpsert
        open={clientDialogOpen}
        onOpenChange={setClientDialogOpen}
        onCreate={handleClientCreate}
      />
    </>
  );
}

function SortableItem({
  id,
  children,
  dragHandle,
}: {
  id: string;
  children: React.ReactNode;
  dragHandle: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2">
      {children}
      <div {...attributes} {...listeners}>
        {dragHandle}
      </div>
    </div>
  );
}
