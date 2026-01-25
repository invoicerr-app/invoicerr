import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, AlertTriangle, ArrowLeft, Info, RefreshCw } from 'lucide-react';
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

const voidReissueSchema = z.object({
  correctionCode: z.string().min(1, 'required'),
  reason: z.string().min(1, 'required'),
  confirmVoid: z.boolean().refine((val) => val === true, {
    message: 'required',
  }),
  items: z.array(
    z.object({
      id: z.string(),
      description: z.string().min(1),
      quantity: z.number().min(0),
      unitPrice: z.number().min(0),
      vatRate: z.number(),
      type: z.string(),
      included: z.boolean(),
    }),
  ),
});

type VoidReissueFormData = z.infer<typeof voidReissueSchema>;

export default function VoidReissuePage() {
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

  const { trigger: voidAndReissue } = usePost(`/api/invoices/${id}/void-reissue`);

  const form = useForm<VoidReissueFormData>({
    resolver: zodResolver(voidReissueSchema),
    defaultValues: {
      correctionCode: '',
      reason: '',
      confirmVoid: false,
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
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        vatRate: item.vatRate,
        type: item.type,
        included: true,
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

  const calculateNewTotals = () => {
    const items = form.watch('items');
    let totalHT = 0;
    let totalVAT = 0;

    items.forEach((item) => {
      if (item.included) {
        const lineTotal = item.quantity * item.unitPrice;
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

  const onSubmit = async (data: VoidReissueFormData) => {
    const includedItems = data.items.filter((item) => item.included);

    if (includedItems.length === 0) {
      toast.error(t('invoices.voidReissue.errors.noItemsIncluded'));
      return;
    }

    setIsSubmitting(true);

    try {
      await voidAndReissue({
        correctionCode: data.correctionCode,
        reason: data.reason,
        items: includedItems.map((item) => ({
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          vatRate: item.vatRate,
          type: item.type as InvoiceItemType,
        })),
      });

      toast.success(t('invoices.voidReissue.success'));
      navigate('/invoices');
    } catch (_error) {
      toast.error(t('invoices.voidReissue.errors.createFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSelectAll = (checked: boolean) => {
    const items = form.getValues('items');
    items.forEach((_, index) => {
      form.setValue(`items.${index}.included`, checked);
    });
  };

  const newTotals = calculateNewTotals();
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
          <AlertDescription>{t('invoices.voidReissue.errors.invoiceNotFound')}</AlertDescription>
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
          <div className="p-2 bg-amber-100 rounded-lg">
            <RefreshCw className="h-5 w-5 text-amber-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{t('invoices.voidReissue.title')}</h1>
            <p className="text-muted-foreground">
              {t('invoices.voidReissue.subtitle', {
                invoiceNumber: invoice.rawNumber || invoice.number,
              })}
            </p>
          </div>
        </div>
      </div>

      {/* Warning banner */}
      <Alert variant="destructive" className="border-amber-300 bg-amber-50 text-amber-800">
        <AlertTriangle className="h-4 w-4 text-amber-600" />
        <AlertDescription className="text-amber-800">
          {t('invoices.voidReissue.warning')}
        </AlertDescription>
      </Alert>

      {/* Original invoice info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t('invoices.voidReissue.originalInvoice')}</CardTitle>
          <CardDescription>
            {t('invoices.voidReissue.originalInvoiceDescription')}
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
            {t('invoices.voidReissue.countryInfo')}
          </AlertDescription>
        </Alert>
      )}

      {/* Void and Reissue Form */}
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          {/* Correction code selection */}
          {modificationOptions?.correctionConfig?.codes &&
            modificationOptions.correctionConfig.codes.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">{t('invoices.voidReissue.correctionType')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <FormField
                    control={form.control}
                    name="correctionCode"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel required>{t('invoices.voidReissue.correctionCode')}</FormLabel>
                        <FormControl>
                          <Select value={field.value} onValueChange={field.onChange}>
                            <SelectTrigger>
                              <SelectValue placeholder={t('invoices.voidReissue.selectCorrectionCode')} />
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
                          {t('invoices.voidReissue.correctionCodeDescription')}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>
            )}

          {/* New invoice items */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg">{t('invoices.voidReissue.newInvoiceItems')}</CardTitle>
                  <CardDescription>{t('invoices.voidReissue.newInvoiceItemsDescription')}</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="selectAll"
                    checked={fields.every((_, i) => form.watch(`items.${i}.included`))}
                    onCheckedChange={(checked) => handleSelectAll(checked as boolean)}
                  />
                  <label htmlFor="selectAll" className="text-sm cursor-pointer">
                    {t('invoices.voidReissue.includeAll')}
                  </label>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {fields.map((field, index) => {
                  const item = form.watch(`items.${index}`);
                  const lineTotal = item.included ? item.quantity * item.unitPrice : 0;

                  return (
                    <div
                      key={field.id}
                      className={`p-4 border rounded-lg transition-all ${
                        item.included
                          ? 'border-primary bg-primary/5'
                          : 'border-muted bg-muted/20 opacity-60'
                      }`}
                    >
                      <div className="space-y-4">
                        <div className="flex items-start gap-4">
                          <FormField
                            control={form.control}
                            name={`items.${index}.included`}
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
                            <FormField
                              control={form.control}
                              name={`items.${index}.description`}
                              render={({ field: descField }) => (
                                <FormItem>
                                  <FormControl>
                                    <BetterInput
                                      {...descField}
                                      disabled={!item.included}
                                      className="font-medium"
                                    />
                                  </FormControl>
                                </FormItem>
                              )}
                            />
                          </div>
                        </div>

                        {item.included && (
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 ml-8">
                            <FormField
                              control={form.control}
                              name={`items.${index}.quantity`}
                              render={({ field: qtyField }) => (
                                <FormItem>
                                  <FormLabel>{t('invoices.voidReissue.quantity')}</FormLabel>
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
                                  <FormLabel>{t('invoices.voidReissue.unitPrice')}</FormLabel>
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
                            <FormField
                              control={form.control}
                              name={`items.${index}.vatRate`}
                              render={({ field: vatField }) => (
                                <FormItem>
                                  <FormLabel>{t('invoices.voidReissue.vatRate')}</FormLabel>
                                  <FormControl>
                                    <BetterInput
                                      {...vatField}
                                      type="number"
                                      min={0}
                                      step="0.1"
                                      onChange={(e) => vatField.onChange(Number(e.target.value))}
                                    />
                                  </FormControl>
                                </FormItem>
                              )}
                            />
                            <div className="flex items-end">
                              <div className="text-right w-full">
                                <p className="text-sm text-muted-foreground">{t('invoices.voidReissue.lineTotal')}</p>
                                <p className="font-medium">{formatCurrency(lineTotal, invoice.currency)}</p>
                              </div>
                            </div>
                          </div>
                        )}
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
              <CardTitle className="text-lg">{t('invoices.voidReissue.reasonTitle')}</CardTitle>
            </CardHeader>
            <CardContent>
              <FormField
                control={form.control}
                name="reason"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>{t('invoices.voidReissue.reason')}</FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        placeholder={t('invoices.voidReissue.reasonPlaceholder')}
                        className="max-h-32"
                      />
                    </FormControl>
                    <FormDescription>
                      {t('invoices.voidReissue.reasonDescription')}
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
              <CardTitle className="text-lg">{t('invoices.voidReissue.summary')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {/* Voided invoice */}
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <span className="inline-block w-2 h-2 rounded-full bg-red-500"></span>
                    {t('invoices.voidReissue.voidedInvoice')}
                  </h4>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{t('invoices.fields.number')}:</span>
                    <span className="line-through text-muted-foreground">{invoice.rawNumber || invoice.number}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{t('invoices.fields.totalTTC')}:</span>
                    <span className="line-through text-muted-foreground">
                      {formatCurrency(invoice.totalTTC, invoice.currency)}
                    </span>
                  </div>
                </div>

                <div className="border-t pt-4 space-y-2">
                  <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <span className="inline-block w-2 h-2 rounded-full bg-green-500"></span>
                    {t('invoices.voidReissue.newInvoice')}
                  </h4>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{t('invoices.fields.totalHT')}:</span>
                    <span>{formatCurrency(newTotals.totalHT, invoice.currency)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{t('invoices.fields.totalVAT')}:</span>
                    <span>{formatCurrency(newTotals.totalVAT, invoice.currency)}</span>
                  </div>
                  <div className="flex justify-between text-lg font-bold pt-2 border-t">
                    <span>{t('invoices.fields.totalTTC')}:</span>
                    <span className="text-green-600">
                      {formatCurrency(newTotals.totalTTC, invoice.currency)}
                    </span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Confirmation */}
          <Card className="border-amber-200 bg-amber-50/50">
            <CardContent className="pt-6">
              <FormField
                control={form.control}
                name="confirmVoid"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <FormLabel className="text-amber-800">
                        {t('invoices.voidReissue.confirmVoid')}
                      </FormLabel>
                      <FormDescription className="text-amber-700">
                        {t('invoices.voidReissue.confirmVoidDescription')}
                      </FormDescription>
                      <FormMessage />
                    </div>
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {/* Actions */}
          <div className="flex justify-end gap-4">
            <Button type="button" variant="outline" onClick={() => navigate('/invoices')}>
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || !form.watch('confirmVoid')}
              variant="destructive"
            >
              {isSubmitting ? t('common.processing') : t('invoices.voidReissue.submit')}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
