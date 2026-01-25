import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, ArrowLeft, FileEdit, Info } from 'lucide-react';
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
import type { Invoice, InvoiceItem, InvoiceItemType } from '@/types';

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

const correctiveInvoiceSchema = z.object({
  correctionCode: z.string().min(1, 'required'),
  reason: z.string().min(1, 'required'),
  items: z.array(
    z.object({
      id: z.string(),
      description: z.string().min(1),
      originalQuantity: z.number(),
      quantity: z.number().min(0),
      originalUnitPrice: z.number(),
      unitPrice: z.number().min(0),
      vatRate: z.number(),
      type: z.string(),
    }),
  ),
});

type CorrectiveInvoiceFormData = z.infer<typeof correctiveInvoiceSchema>;

export default function CorrectiveInvoicePage() {
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

  const { trigger: createCorrectiveInvoice } = usePost(`/api/invoices/${id}/corrective`);

  const form = useForm<CorrectiveInvoiceFormData>({
    resolver: zodResolver(correctiveInvoiceSchema),
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
        quantity: item.quantity,
        originalUnitPrice: item.unitPrice,
        unitPrice: item.unitPrice,
        vatRate: item.vatRate,
        type: item.type,
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
      const lineTotal = item.quantity * item.unitPrice;
      const lineVAT = lineTotal * (item.vatRate / 100);
      totalHT += lineTotal;
      totalVAT += lineVAT;
    });

    return {
      totalHT,
      totalVAT,
      totalTTC: totalHT + totalVAT,
    };
  };

  const calculateOriginalTotals = () => {
    const items = form.watch('items');
    let totalHT = 0;
    let totalVAT = 0;

    items.forEach((item) => {
      const lineTotal = item.originalQuantity * item.originalUnitPrice;
      const lineVAT = lineTotal * (item.vatRate / 100);
      totalHT += lineTotal;
      totalVAT += lineVAT;
    });

    return {
      totalHT,
      totalVAT,
      totalTTC: totalHT + totalVAT,
    };
  };

  const hasChanges = () => {
    const items = form.watch('items');
    return items.some(
      (item) =>
        item.quantity !== item.originalQuantity ||
        item.unitPrice !== item.originalUnitPrice,
    );
  };

  const onSubmit = async (data: CorrectiveInvoiceFormData) => {
    if (!hasChanges()) {
      toast.error(t('invoices.correctiveInvoice.errors.noChanges'));
      return;
    }

    setIsSubmitting(true);

    try {
      await createCorrectiveInvoice({
        correctionCode: data.correctionCode,
        reason: data.reason,
        items: data.items.map((item) => ({
          originalItemId: item.id,
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          vatRate: item.vatRate,
          type: item.type as InvoiceItemType,
        })),
      });

      toast.success(t('invoices.correctiveInvoice.success'));
      navigate('/invoices');
    } catch (_error) {
      toast.error(t('invoices.correctiveInvoice.errors.createFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const totals = calculateTotals();
  const originalTotals = calculateOriginalTotals();
  const difference = {
    totalHT: totals.totalHT - originalTotals.totalHT,
    totalVAT: totals.totalVAT - originalTotals.totalVAT,
    totalTTC: totals.totalTTC - originalTotals.totalTTC,
  };

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
          <AlertDescription>{t('invoices.correctiveInvoice.errors.invoiceNotFound')}</AlertDescription>
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
          <div className="p-2 bg-orange-100 rounded-lg">
            <FileEdit className="h-5 w-5 text-orange-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{t('invoices.correctiveInvoice.title')}</h1>
            <p className="text-muted-foreground">
              {t('invoices.correctiveInvoice.subtitle', {
                invoiceNumber: invoice.rawNumber || invoice.number,
              })}
            </p>
          </div>
        </div>
      </div>

      {/* Original invoice info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t('invoices.correctiveInvoice.originalInvoice')}</CardTitle>
          <CardDescription>
            {t('invoices.correctiveInvoice.originalInvoiceDescription')}
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
            {t('invoices.correctiveInvoice.countryRequiresReference')}
          </AlertDescription>
        </Alert>
      )}

      {/* Corrective Invoice Form */}
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          {/* Correction code selection */}
          {modificationOptions?.correctionConfig?.codes &&
            modificationOptions.correctionConfig.codes.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">{t('invoices.correctiveInvoice.correctionType')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <FormField
                    control={form.control}
                    name="correctionCode"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel required>{t('invoices.correctiveInvoice.correctionCode')}</FormLabel>
                        <FormControl>
                          <Select value={field.value} onValueChange={field.onChange}>
                            <SelectTrigger>
                              <SelectValue placeholder={t('invoices.correctiveInvoice.selectCorrectionCode')} />
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
                          {t('invoices.correctiveInvoice.correctionCodeDescription')}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>
            )}

          {/* Items correction */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{t('invoices.correctiveInvoice.itemsToCorrect')}</CardTitle>
              <CardDescription>{t('invoices.correctiveInvoice.itemsToCorrectDescription')}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {fields.map((field, index) => {
                  const item = form.watch(`items.${index}`);
                  const lineTotal = item.quantity * item.unitPrice;
                  const originalLineTotal = item.originalQuantity * item.originalUnitPrice;
                  const lineDifference = lineTotal - originalLineTotal;
                  const hasItemChanged =
                    item.quantity !== item.originalQuantity ||
                    item.unitPrice !== item.originalUnitPrice;

                  return (
                    <div
                      key={field.id}
                      className={`p-4 border rounded-lg transition-all ${
                        hasItemChanged
                          ? 'border-orange-300 bg-orange-50/50'
                          : 'border-muted'
                      }`}
                    >
                      <div className="space-y-4">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <p className="font-medium">{item.description}</p>
                            <p className="text-sm text-muted-foreground mt-1">
                              {t('invoices.correctiveInvoice.originalValues')}: {item.originalQuantity} x{' '}
                              {formatCurrency(item.originalUnitPrice, invoice.currency)}
                              {item.vatRate > 0 && ` (${item.vatRate}% ${t('common.vat')})`}
                            </p>
                          </div>
                          {hasItemChanged && (
                            <span className={`text-sm font-medium ${lineDifference >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                              {lineDifference >= 0 ? '+' : ''}
                              {formatCurrency(lineDifference, invoice.currency)}
                            </span>
                          )}
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                          <FormField
                            control={form.control}
                            name={`items.${index}.quantity`}
                            render={({ field: qtyField }) => (
                              <FormItem>
                                <FormLabel>{t('invoices.correctiveInvoice.quantity')}</FormLabel>
                                <FormControl>
                                  <BetterInput
                                    {...qtyField}
                                    type="number"
                                    min={0}
                                    step="1"
                                    onChange={(e) => qtyField.onChange(Number(e.target.value))}
                                  />
                                </FormControl>
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name={`items.${index}.unitPrice`}
                            render={({ field: priceField }) => (
                              <FormItem>
                                <FormLabel>{t('invoices.correctiveInvoice.unitPrice')}</FormLabel>
                                <FormControl>
                                  <BetterInput
                                    {...priceField}
                                    type="number"
                                    min={0}
                                    step="0.01"
                                    onChange={(e) => priceField.onChange(Number(e.target.value))}
                                  />
                                </FormControl>
                              </FormItem>
                            )}
                          />
                          <div className="flex items-end">
                            <div className="text-right w-full">
                              <p className="text-sm text-muted-foreground">{t('invoices.correctiveInvoice.lineTotal')}</p>
                              <p className="font-medium">{formatCurrency(lineTotal, invoice.currency)}</p>
                            </div>
                          </div>
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
              <CardTitle className="text-lg">{t('invoices.correctiveInvoice.reasonTitle')}</CardTitle>
            </CardHeader>
            <CardContent>
              <FormField
                control={form.control}
                name="reason"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>{t('invoices.correctiveInvoice.reason')}</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        placeholder={t('invoices.correctiveInvoice.reasonPlaceholder')}
                        className="max-h-32"
                      />
                    </FormControl>
                    <FormDescription>
                      {t('invoices.correctiveInvoice.reasonDescription')}
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
              <CardTitle className="text-lg">{t('invoices.correctiveInvoice.summary')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {/* Original totals */}
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-muted-foreground">
                    {t('invoices.correctiveInvoice.originalTotals')}
                  </h4>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{t('invoices.fields.totalHT')}:</span>
                    <span>{formatCurrency(originalTotals.totalHT, invoice.currency)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{t('invoices.fields.totalVAT')}:</span>
                    <span>{formatCurrency(originalTotals.totalVAT, invoice.currency)}</span>
                  </div>
                  <div className="flex justify-between text-sm font-medium">
                    <span>{t('invoices.fields.totalTTC')}:</span>
                    <span>{formatCurrency(originalTotals.totalTTC, invoice.currency)}</span>
                  </div>
                </div>

                <div className="border-t pt-4 space-y-2">
                  <h4 className="text-sm font-medium text-muted-foreground">
                    {t('invoices.correctiveInvoice.correctedTotals')}
                  </h4>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{t('invoices.fields.totalHT')}:</span>
                    <span>{formatCurrency(totals.totalHT, invoice.currency)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{t('invoices.fields.totalVAT')}:</span>
                    <span>{formatCurrency(totals.totalVAT, invoice.currency)}</span>
                  </div>
                  <div className="flex justify-between text-sm font-medium">
                    <span>{t('invoices.fields.totalTTC')}:</span>
                    <span>{formatCurrency(totals.totalTTC, invoice.currency)}</span>
                  </div>
                </div>

                {hasChanges() && (
                  <div className="border-t pt-4 space-y-2">
                    <h4 className="text-sm font-medium text-muted-foreground">
                      {t('invoices.correctiveInvoice.difference')}
                    </h4>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{t('invoices.fields.totalHT')}:</span>
                      <span className={difference.totalHT >= 0 ? 'text-green-600' : 'text-red-600'}>
                        {difference.totalHT >= 0 ? '+' : ''}
                        {formatCurrency(difference.totalHT, invoice.currency)}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{t('invoices.fields.totalVAT')}:</span>
                      <span className={difference.totalVAT >= 0 ? 'text-green-600' : 'text-red-600'}>
                        {difference.totalVAT >= 0 ? '+' : ''}
                        {formatCurrency(difference.totalVAT, invoice.currency)}
                      </span>
                    </div>
                    <div className="flex justify-between text-lg font-bold pt-2 border-t">
                      <span>{t('invoices.correctiveInvoice.totalDifference')}:</span>
                      <span className={difference.totalTTC >= 0 ? 'text-green-600' : 'text-red-600'}>
                        {difference.totalTTC >= 0 ? '+' : ''}
                        {formatCurrency(difference.totalTTC, invoice.currency)}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Actions */}
          <div className="flex justify-end gap-4">
            <Button type="button" variant="outline" onClick={() => navigate('/invoices')}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={isSubmitting || !hasChanges()}>
              {isSubmitting ? t('common.creating') : t('invoices.correctiveInvoice.create')}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
