'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { BetterInput } from '@/components/better-input';
import SearchSelect from '@/components/search-input';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useGet, usePatch, usePost } from '@/hooks/use-fetch';
import type { Invoice, InvoiceItem, PaymentMethod, Receipt } from '@/types';
import { PaymentMethodType } from '@/types';
import { ClientUpsert } from '../../clients/_components/client-upsert';

interface ReceiptUpsertDialogProps {
  receipt?: Receipt | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface Item {
  invoiceItemId: string;
  description: string;
  amountPaid: number;
}

export function ReceiptUpsert({ receipt, open, onOpenChange }: ReceiptUpsertDialogProps) {
  const { t } = useTranslation();
  const isEdit = !!receipt;

  const [clientDialogOpen, setClientDialogOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [selectedItem, setSelectedItem] = useState<InvoiceItem | null>(null);
  const [items, setItems] = useState<Item[]>(
    receipt?.items.map((item) => ({
      invoiceItemId: item.invoiceItemId,
      description:
        receipt.invoice?.items.find((invItem) => invItem.id === item.invoiceItemId)?.description ||
        '',
      amountPaid: item.amountPaid,
    })) || [],
  );

  const receiptSchema = z.object({
    invoiceId: z.string().optional(),
    paymentMethodId: z.string().optional(),
  });

  const { data: invoices } = useGet<Invoice[]>(`/api/invoices/search?query=${searchTerm}`);
  const { data: paymentMethods } = useGet<PaymentMethod[]>(`/api/payment-methods`);
  const { trigger: createTrigger, loading: createLoading } = usePost('/api/receipts');
  const { trigger: updateTrigger, loading: updateLoading } = usePatch(
    `/api/receipts/${receipt?.id}`,
  );

  const form = useForm<z.infer<typeof receiptSchema>>({
    resolver: zodResolver(receiptSchema),
    defaultValues: {
      invoiceId: receipt?.invoiceId || '',
      paymentMethodId: receipt?.paymentMethodId || '',
    },
  });

  useEffect(() => {
    if (isEdit && receipt) {
      form.reset({
        invoiceId: receipt.invoiceId || '',
        paymentMethodId: (receipt as any).paymentMethodId || '',
      });
      setItems(
        receipt.items.map((item) => ({
          invoiceItemId: item.invoiceItemId,
          description:
            receipt.invoice?.items.find((invItem) => invItem.id === item.invoiceItemId)
              ?.description || '',
          amountPaid: item.amountPaid,
        })),
      );
      setSelectedInvoice(receipt.invoice || null);
      setSelectedItem(null);
    } else {
      form.reset({
        invoiceId: '',
        paymentMethodId: '',
      });
      setItems([]);
    }
  }, [receipt, form, isEdit]);

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setSelectedInvoice(null);
      setSelectedItem(null);
      setItems([]);
      form.reset();
    }
    onOpenChange(open);
  };

  const onSubmit = (data: z.infer<typeof receiptSchema>) => {
    const trigger = isEdit ? updateTrigger : createTrigger;
    trigger({
      ...data,
      items: items.map((item) => ({
        invoiceItemId: item.invoiceItemId,
        invoiceId: selectedInvoice?.id || '',
        amountPaid: item.amountPaid,
        receiptId: receipt?.id || '',
      })),
    })
      .then(() => {
        onOpenChange(false);
        form.reset();
      })
      .catch((err) => console.error(err));
  };

  useEffect(() => {
    if (selectedInvoice) {
      form.setValue('paymentMethodId', selectedInvoice.paymentMethodId || '');
    }
  }, [form, selectedInvoice]);

  const onAddItem = () => {
    if (selectedItem) {
      setItems([
        ...items,
        {
          invoiceItemId: selectedItem.id,
          description: selectedItem.description,
          amountPaid: selectedItem.unitPrice * selectedItem.quantity,
        },
      ]);
    }
  };

  const onRemoveItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const onEditItem = (index: number, field: keyof Item) => (value: string | number) => {
    setItems(items.map((item, i) => (i === index ? { ...item, [field]: value } : item)));
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          className="max-w-sm lg:max-w-4xl min-w-fit max-h-[90vh] overflow-y-auto overflow-visible"
          dataCy="receipt-dialog"
        >
          <DialogHeader className="h-fit">
            <DialogTitle>{t(`receipts.upsert.title.${isEdit ? 'edit' : 'create'}`)}</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} data-cy="receipt-form">
              <FormField
                control={form.control}
                name="invoiceId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>{t('receipts.upsert.form.invoice.label')}</FormLabel>
                    <FormControl>
                      <SearchSelect
                        options={(invoices || []).map((invoice) => ({
                          label: invoice.rawNumber || invoice.number.toString(),
                          value: invoice.id,
                        }))}
                        value={field.value ?? ''}
                        onValueChange={(val) => {
                          field.onChange(val || null);
                          setSelectedInvoice(invoices?.find((inv) => inv.id === val) || null);
                          setSelectedItem(null);
                        }}
                        onSearchChange={setSearchTerm}
                        placeholder={t('receipts.upsert.form.invoice.placeholder')}
                        noResultsText={t('receipts.upsert.form.invoice.noResults')}
                        data-cy="receipt-invoice-select"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="paymentMethodId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('receipts.upsert.form.paymentMethod.label')}</FormLabel>
                    <FormControl>
                      <Select
                        value={field.value ?? ''}
                        onValueChange={(val) => field.onChange(val || '')}
                      >
                        <SelectTrigger
                          className="w-full"
                          aria-label={t('receipts.upsert.form.paymentMethod.label') as string}
                        >
                          <SelectValue
                            placeholder={t('receipts.upsert.form.paymentMethod.placeholder')}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {(paymentMethods || []).map((pm: PaymentMethod) => (
                            <SelectItem key={pm.id} value={pm.id}>
                              {pm.name} -{' '}
                              {pm.type === PaymentMethodType.BANK_TRANSFER
                                ? t('paymentMethods.fields.type.bank_transfer')
                                : pm.type === PaymentMethodType.PAYPAL
                                  ? t('paymentMethods.fields.type.paypal')
                                  : pm.type === PaymentMethodType.CHECK
                                    ? t('paymentMethods.fields.type.check')
                                    : pm.type === PaymentMethodType.CASH
                                      ? t('paymentMethods.fields.type.cash')
                                      : pm.type === PaymentMethodType.OTHER
                                        ? t('paymentMethods.fields.type.other')
                                        : pm.type}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormDescription>
                      {t('receipts.upsert.form.paymentMethod.description')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormItem className="flex flex-col gap-2 mt-2">
                <FormLabel className="mb-0">{t('receipts.upsert.form.items.label')}</FormLabel>

                <section className="grid grid-cols-1 md:grid-cols-4 gap-2 m-0!">
                  <FormItem className="col-span-3">
                    <FormControl>
                      <SearchSelect
                        options={(selectedInvoice?.items || [])
                          .filter((item) => !items.some((i) => i.invoiceItemId === item.id))
                          .map((item) => ({ label: item.description, value: item.id }))}
                        value={selectedItem?.id || undefined}
                        onValueChange={(val) => {
                          setSelectedItem(
                            (selectedInvoice?.items || []).find((item) => item.id === val) || null,
                          );
                        }}
                        onSearchChange={setSearchTerm}
                        placeholder={t('receipts.upsert.form.items.placeholder')}
                        noResultsText={t('receipts.upsert.form.items.noResults')}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!selectedItem}
                    onClick={onAddItem}
                  >
                    {t('receipts.upsert.form.items.addButton')}
                  </Button>
                </section>
                <div className="flex flex-col gap-2">
                  {items.map((item, index) => (
                    <div key={item.invoiceItemId} className="flex gap-2 items-center">
                      <FormItem className="flex-1">
                        <FormControl>
                          <BetterInput
                            defaultValue={item.description || ''}
                            placeholder={t('receipts.upsert.form.items.description.placeholder')}
                            onChange={(e) => onEditItem(index, 'description')(e.target.value)}
                            disabled
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                      <FormItem>
                        <FormControl>
                          <BetterInput
                            defaultValue={item.amountPaid || ''}
                            placeholder={t('receipts.upsert.form.items.amountPaid.placeholder')}
                            onChange={(e) =>
                              onEditItem(index, 'amountPaid')(parseFloat(e.target.value))
                            }
                            type="number"
                            min={0}
                            step="0.01"
                            postAdornment={selectedInvoice?.currency || ''}
                            disabled={!selectedInvoice}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>

                      <Button
                        variant={'outline'}
                        onClick={() => onRemoveItem(index)}
                        type="reset"
                        className="h-8"
                      >
                        <Trash2 className="h-4 w-4 text-red-700" />
                      </Button>
                    </div>
                  ))}
                </div>
              </FormItem>
            </form>
          </Form>
          <DialogFooter className="flex justify-end space-x-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('receipts.upsert.actions.cancel')}
            </Button>
            <Button
              type="button"
              onClick={form.handleSubmit(onSubmit)}
              loading={createLoading || updateLoading}
              dataCy="receipt-submit"
            >
              {t(`receipts.upsert.actions.${isEdit ? 'save' : 'create'}`)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ClientUpsert open={clientDialogOpen} onOpenChange={setClientDialogOpen} />
    </>
  );
}
