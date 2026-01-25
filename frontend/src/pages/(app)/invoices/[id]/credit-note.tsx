import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, ArrowLeft, FileMinus, Info } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';

import { BetterInput } from '@/components/better-input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
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
import { Textarea } from '@/components/ui/textarea';
import { useGet, usePost } from '@/hooks/use-fetch';
import type { Invoice, InvoiceItem } from '@/types';

interface CorrectionCode {
  code: string;
  labelKey: string;
  ublTypeCode?: string;
}

interface ModificationOptionsResponse {
  invoiceId: string;
  invoiceNumber: string;
  invoiceStatus: string;
  countryCode: string;
  correctionConfig: {
    allowDirectModification: boolean;
    method: string;
    requiresOriginalReference: boolean;
    codes: CorrectionCode[];
    requiresPreApproval: boolean;
  } | null;
}

const creditNoteSchema = z.object({
  correctionCode: z.string().min(1, 'required'),
  reason: z.string().optional(),
  items: z.array(
    z.object({
      id: z.string(),
      description: z.string(),
      originalQuantity: z.number(),
      creditQuantity: z.number().min(0),
      unitPrice: z.number(),
      vatRate: z.number(),
      selected: z.boolean(),
    }),
  ),
});

type CreditNoteFormData = z.infer<typeof creditNoteSchema>;

export default function CreditNotePage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data: invoice, loading: invoiceLoading } = useGet<Invoice>(
    id ? `/api/invoices/${id}` : null,
  );

  const { data: modificationOptions, loading: optionsLoading } =
    useGet<ModificationOptionsResponse>(
      id ? `/api/invoices/${id}/modification-options` : null,
    );

  const { trigger: createCreditNote } = usePost(`/api/invoices/${id}/credit-note`);

  const form = useForm<CreditNoteFormData>({
    resolver: zodResolver(creditNoteSchema),
    defaultValues: {
      correctionCode: '',
      reason: '',
      items: [],
    },
  });

  const { fields } = useFieldArray({
    control: form.control,
    name: 'items',
  });

  // Initialize items from invoice
  useEffect(() => {
    if (invoice?.items) {
      const items = invoice.items.map((item: InvoiceItem) => ({
        id: item.id,
        description: item.description,
        originalQuantity: item.quantity,
        creditQuantity: item.quantity,
        unitPrice: item.unitPrice,
        vatRate: item.vatRate,
        selected: true,
      }));
      form.setValue('items', items);
    }
  }, [invoice, form]);

  // Set default correction code
  useEffect(() => {
    if (modificationOptions?.correctionConfig?.codes?.length) {
      const defaultCode = modificationOptions.correctionConfig.codes[0].code;
      form.setValue('correctionCode', defaultCode);
    }
  }, [modificationOptions, form]);

  const formatCurrency = (amount: number, currency: string = 'EUR') => {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
    }).format(amount);
  };

  const calculateTotals = () => {
    const items = form.watch('items');
    let totalHT = 0;
    let totalVAT = 0;

    items.forEach((item) => {
      if (item.selected) {
        const lineTotal = item.creditQuantity * item.unitPrice;
        const lineVAT = lineTotal * (item.vatRate / 100);
        totalHT += lineTotal;
        totalVAT += lineVAT;
      }
    });

    return {
      totalHT,
      totalVAT,
      totalTTC: totalHT + totalVAT,
    };
  };

  const onSubmit = async (data: CreditNoteFormData) => {
    const selectedItems = data.items.filter((item) => item.selected && item.creditQuantity > 0);

    if (selectedItems.length === 0) {
      toast.error(t('invoices.creditNote.errors.noItemsSelected'));
      return;
    }

    setIsSubmitting(true);

    try {
      await createCreditNote({
        correctionCode: data.correctionCode,
        reason: data.reason,
        items: selectedItems.map((item) => ({
          originalItemId: item.id,
          quantity: item.creditQuantity,
        })),
      });

      toast.success(t('invoices.creditNote.success'));
      navigate('/invoices');
    } catch (_error) {
      toast.error(t('invoices.creditNote.errors.createFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSelectAll = (checked: boolean) => {
    const items = form.getValues('items');
    items.forEach((_, index) => {
      form.setValue(`items.${index}.selected`, checked);
      if (checked) {
        form.setValue(`items.${index}.creditQuantity`, items[index].originalQuantity);
      }
    });
  };

  const totals = calculateTotals();
  const loading = invoiceLoading || optionsLoading;

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <Card>
          <CardContent className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            <span className="ml-3">{t('common.loading')}</span>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{t('invoices.creditNote.errors.invoiceNotFound')}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/invoices')}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex items-center gap-3">
          <div className="p-2 bg-red-100 rounded-lg">
            <FileMinus className="h-5 w-5 text-red-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{t('invoices.creditNote.title')}</h1>
            <p className="text-muted-foreground">
              {t('invoices.creditNote.subtitle', {
                invoiceNumber: invoice.rawNumber || invoice.number,
              })}
            </p>
          </div>
        </div>
      </div>

      {/* Original invoice info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t('invoices.creditNote.originalInvoice')}</CardTitle>
          <CardDescription>
            {t('invoices.creditNote.originalInvoiceDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">{t('invoices.fields.number')}:</span>
              <p className="font-medium">{invoice.rawNumber || invoice.number}</p>
            </div>
            <div>
              <span className="text-muted-foreground">{t('invoices.fields.client')}:</span>
              <p className="font-medium">{invoice.client?.name || '-'}</p>
            </div>
            <div>
              <span className="text-muted-foreground">{t('invoices.fields.date')}:</span>
              <p className="font-medium">
                {new Date(invoice.createdAt).toLocaleDateString()}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">{t('invoices.fields.total')}:</span>
              <p className="font-medium">{formatCurrency(invoice.totalTTC, invoice.currency)}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Country info banner */}
      {modificationOptions?.correctionConfig && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            <span className="font-medium">{modificationOptions.countryCode}:</span>{' '}
            {t('invoices.creditNote.countryRequiresReference')}
          </AlertDescription>
        </Alert>
      )}

      {/* Credit Note Form */}
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          {/* Correction code selection */}
          {modificationOptions?.correctionConfig?.codes &&
            modificationOptions.correctionConfig.codes.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">{t('invoices.creditNote.correctionType')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <FormField
                    control={form.control}
                    name="correctionCode"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel required>{t('invoices.creditNote.correctionCode')}</FormLabel>
                        <FormControl>
                          <Select value={field.value} onValueChange={field.onChange}>
                            <SelectTrigger>
                              <SelectValue placeholder={t('invoices.creditNote.selectCorrectionCode')} />
                            </SelectTrigger>
                            <SelectContent>
                              {modificationOptions.correctionConfig!.codes.map((code) => (
                                <SelectItem key={code.code} value={code.code}>
                                  {code.code} - {t(code.labelKey, { defaultValue: code.code })}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </FormControl>
                        <FormDescription>
                          {t('invoices.creditNote.correctionCodeDescription')}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>
            )}

          {/* Items selection */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg">{t('invoices.creditNote.itemsToCredit')}</CardTitle>
                  <CardDescription>{t('invoices.creditNote.itemsToCreditDescription')}</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="selectAll"
                    checked={fields.every((_, i) => form.watch(`items.${i}.selected`))}
                    onCheckedChange={(checked) => handleSelectAll(checked as boolean)}
                  />
                  <label htmlFor="selectAll" className="text-sm cursor-pointer">
                    {t('invoices.creditNote.selectAll')}
                  </label>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {fields.map((field, index) => {
                  const item = form.watch(`items.${index}`);
                  const lineTotal = item.selected ? item.creditQuantity * item.unitPrice : 0;

                  return (
                    <div
                      key={field.id}
                      className={`p-4 border rounded-lg transition-all ${
                        item.selected
                          ? 'border-primary bg-primary/5'
                          : 'border-muted bg-muted/20 opacity-60'
                      }`}
                    >
                      <div className="flex items-start gap-4">
                        <FormField
                          control={form.control}
                          name={`items.${index}.selected`}
                          render={({ field: checkField }) => (
                            <FormItem className="mt-1">
                              <FormControl>
                                <Checkbox
                                  checked={checkField.value}
                                  onCheckedChange={checkField.onChange}
                                />
                              </FormControl>
                            </FormItem>
                          )}
                        />

                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{item.description}</p>
                          <p className="text-sm text-muted-foreground mt-1">
                            {t('invoices.creditNote.originalQuantity')}: {item.originalQuantity} ×{' '}
                            {formatCurrency(item.unitPrice, invoice.currency)}
                            {item.vatRate > 0 && ` (${item.vatRate}% ${t('common.vat')})`}
                          </p>
                        </div>

                        <div className="flex items-center gap-2">
                          <FormField
                            control={form.control}
                            name={`items.${index}.creditQuantity`}
                            render={({ field: qtyField }) => (
                              <FormItem>
                                <FormControl>
                                  <BetterInput
                                    {...qtyField}
                                    type="number"
                                    min={0}
                                    max={item.originalQuantity}
                                    className="w-24"
                                    disabled={!item.selected}
                                    onChange={(e) => {
                                      const val = Math.min(
                                        Math.max(0, Number(e.target.value)),
                                        item.originalQuantity,
                                      );
                                      qtyField.onChange(val);
                                    }}
                                  />
                                </FormControl>
                              </FormItem>
                            )}
                          />
                          <span className="text-sm text-muted-foreground w-24 text-right">
                            {formatCurrency(lineTotal, invoice.currency)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Reason */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t('invoices.creditNote.reasonTitle')}</CardTitle>
            </CardHeader>
            <CardContent>
              <FormField
                control={form.control}
                name="reason"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('invoices.creditNote.reason')}</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        placeholder={t('invoices.creditNote.reasonPlaceholder')}
                        className="max-h-32"
                      />
                    </FormControl>
                    <FormDescription>
                      {t('invoices.creditNote.reasonDescription')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {/* Summary */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t('invoices.creditNote.summary')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{t('invoices.fields.totalHT')}:</span>
                  <span className="font-medium">
                    -{formatCurrency(totals.totalHT, invoice.currency)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{t('invoices.fields.totalVAT')}:</span>
                  <span className="font-medium">
                    -{formatCurrency(totals.totalVAT, invoice.currency)}
                  </span>
                </div>
                <div className="flex justify-between text-lg font-bold pt-2 border-t">
                  <span>{t('invoices.creditNote.totalCredit')}:</span>
                  <span className="text-red-600">
                    -{formatCurrency(totals.totalTTC, invoice.currency)}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Actions */}
          <div className="flex justify-end gap-4">
            <Button type="button" variant="outline" onClick={() => navigate('/invoices')}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t('common.creating') : t('invoices.creditNote.create')}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
