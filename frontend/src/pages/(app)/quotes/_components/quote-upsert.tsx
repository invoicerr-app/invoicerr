'use client';

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
import type { Client, PaymentMethod, Quote } from '@/types';
import { PaymentMethodType } from '@/types';
import { ClientUpsert } from '../../clients/_components/client-upsert';

interface QuoteUpsertDialogProps {
  quote?: Quote | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function QuoteUpsert({ quote, open, onOpenChange }: QuoteUpsertDialogProps) {
  const { t } = useTranslation();
  const isEdit = !!quote;

  const [clientDialogOpen, setClientDialogOpen] = useState(false);

  // Move schema inside component to access t function
  const quoteSchema = z.object({
    title: z.string().optional(),
    clientId: z
      .string()
      .min(1, t('quotes.upsert.form.client.errors.required'))
      .refine((val) => val !== '', {
        message: t('quotes.upsert.form.client.errors.required'),
      }),
    currency: z.string().optional(),
    validUntil: z.date().optional(),
    notes: z.string().optional(),
    paymentMethodId: z.string().optional(),
    items: z.array(
      z.object({
        id: z.string().optional(),
        description: z
          .string()
          .min(1, t('quotes.upsert.form.items.description.errors.required'))
          .refine((val) => val !== '', {
            message: t('quotes.upsert.form.items.description.errors.required'),
          }),
        type: z.string(),
        quantity: z
          .number({ invalid_type_error: t('quotes.upsert.form.items.quantity.errors.required') })
          .min(1, t('quotes.upsert.form.items.quantity.errors.min'))
          .refine((val) => !isNaN(val), {
            message: t('quotes.upsert.form.items.quantity.errors.invalid'),
          }),
        unitPrice: z
          .number({
            invalid_type_error: t('quotes.upsert.form.items.unitPrice.errors.required'),
          })
          .min(0, t('quotes.upsert.form.items.unitPrice.errors.min'))
          .refine((val) => !isNaN(val), {
            message: t('quotes.upsert.form.items.unitPrice.errors.invalid'),
          }),
        vatRate: z
          .number({ invalid_type_error: t('quotes.upsert.form.items.vatRate.errors.required') })
          .min(0, t('quotes.upsert.form.items.vatRate.errors.min')),
        order: z.number(),
      }),
    ),
  });

  const [searchTerm, setSearchTerm] = useState('');
  const { data: clients } = useGet<Client[]>(`/api/clients/search?query=${searchTerm}`);
  const { data: paymentMethods } = useGet<PaymentMethod[]>(`/api/payment-methods`);

  const { trigger: createTrigger } = usePost('/api/quotes');
  const { trigger: updateTrigger } = usePatch(`/api/quotes/${quote?.id}`);

  const form = useForm<z.infer<typeof quoteSchema>>({
    resolver: zodResolver(quoteSchema),
    defaultValues: {
      title: '',
      clientId: '',
      validUntil: undefined,
      notes: '',
      items: [],
    },
  });

  useEffect(() => {
    if (isEdit && quote) {
      form.reset({
        title: quote.title || '',
        clientId: quote.clientId || '',
        validUntil: quote.validUntil ? new Date(quote.validUntil) : undefined,
        currency: quote.currency,
        notes: quote.notes || '',
        paymentMethodId: (quote as any).paymentMethodId || '',
        items: quote.items
          .sort((a, b) => a.order - b.order)
          .map((item) => ({
            id: item.id,
            type: item.type,
            description: item.description || '',
            quantity: item.quantity || 1,
            unitPrice: item.unitPrice || 0,
            vatRate: item.vatRate || 0,
            order: item.order || 0,
          })),
      });
    } else {
      form.reset({
        title: '',
        clientId: '',
        validUntil: undefined,
        notes: '',
        items: [],
      });
    }
  }, [quote, form, isEdit]);

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

  const onSubmit = (data: z.infer<typeof quoteSchema>) => {
    console.debug('Submitting quote data:', data);

    const trigger = isEdit ? updateTrigger : createTrigger;

    trigger(data)
      .then(() => {
        onOpenChange(false);
        form.reset();
      })
      .catch((err) => console.error(err));
  };

  const handleClientCreate = (newClient: Client) => {
    setSearchTerm('');
    form.setValue('clientId', newClient.id);
    clients?.push(newClient);
    form.trigger('clientId');
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-sm lg:max-w-4xl" dataCy="quote-dialog">
          <DialogHeader>
            <DialogTitle>{t(`quotes.upsert.title.${isEdit ? 'edit' : 'create'}`)}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" data-cy="quote-form">
              <FormField
                control={control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('quotes.upsert.form.title.label')}</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder={t('quotes.upsert.form.title.placeholder')} />
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
                    <FormLabel required>{t('quotes.upsert.form.client.label')}</FormLabel>
                    <FormControl>
                      <SearchSelect
                        options={(clients || []).map((c) => ({
                          label: c.name || c.contactFirstname + ' ' + c.contactLastname,
                          value: c.id,
                        }))}
                        value={field.value ?? ''}
                        onValueChange={(val) => field.onChange(val || null)}
                        onSearchChange={setSearchTerm}
                        placeholder={t('quotes.upsert.form.client.placeholder')}
                        data-cy="quote-client-select"
                        noResultsComponent={
                          <Button variant="link" onClick={() => setClientDialogOpen(true)}>
                            {t('quotes.upsert.form.client.noOptions')}
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
                    <FormLabel>{t('quotes.upsert.form.currency.label')}</FormLabel>
                    <FormControl>
                      <CurrencySelect
                        value={field.value}
                        onChange={(value) => field.onChange(value)}
                        data-cy="quote-currency-select"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={control}
                name="validUntil"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('quotes.upsert.form.validUntil.label')}</FormLabel>
                    <FormControl>
                      <DatePicker
                        className="w-full"
                        value={field.value || null}
                        onChange={field.onChange}
                        placeholder={t('quotes.upsert.form.validUntil.placeholder')}
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
                    <FormLabel>{t('quotes.upsert.form.notes.label')}</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        placeholder={t('quotes.upsert.form.notes.placeholder')}
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
                    <FormLabel>{t('quotes.upsert.form.paymentMethod.label')}</FormLabel>
                    <FormControl>
                      <Select
                        value={field.value ?? ''}
                        onValueChange={(val) => field.onChange(val || '')}
                      >
                        <SelectTrigger>
                          <SelectValue
                            placeholder={t('quotes.upsert.form.paymentMethod.placeholder')}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {paymentMethods?.map((pm: PaymentMethod) => (
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
                      {t('quotes.upsert.form.paymentMethod.description')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormItem>
                <FormLabel>{t('quotes.upsert.form.items.label')}</FormLabel>
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
                                        `quotes.upsert.form.items.description.placeholder`,
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
                                      postAdornment={t(`quotes.upsert.form.items.quantity.unit`)}
                                      type="number"
                                      placeholder={t(
                                        `quotes.upsert.form.items.quantity.placeholder`,
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
                                        `quotes.upsert.form.items.unitPrice.placeholder`,
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
                                      defaultValue={field.value || ''}
                                      postAdornment="%"
                                      type="number"
                                      step="0.01"
                                      placeholder={t(
                                        `quotes.upsert.form.items.vatRate.placeholder`,
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

                            <Button
                              variant={'outline'}
                              onClick={() => onRemove(index)}
                              dataCy={`remove-item-${index}`}
                            >
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
                      type: 'HOUR',
                      quantity: Number.NaN,
                      unitPrice: Number.NaN,
                      vatRate: Number.NaN,
                      order: fields.length,
                    })
                  }
                >
                  <Plus className="mr-2 h-4 w-4" />
                  {t('quotes.upsert.form.items.addItem')}
                </Button>
              </FormItem>

              <div className="flex justify-end space-x-2">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  {t('quotes.upsert.actions.cancel')}
                </Button>
                <Button type="submit" dataCy="quote-submit">
                  {t(`quotes.upsert.actions.${isEdit ? 'save' : 'create'}`)}
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
