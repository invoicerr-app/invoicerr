import { zodResolver } from '@hookform/resolvers/zod';
import { format } from 'date-fns';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { z } from 'zod';
import { getCountryName } from '@/components/country-select';
import CurrencySelect from '@/components/currency-select';
import { DatePicker } from '@/components/date-picker';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Switch } from '@/components/ui/switch';
import { useCountryIdentifiers } from '@/hooks/use-compliance';
import { useGet, usePost } from '@/hooks/use-fetch';
import type { Company } from '@/types';

export default function CompanySettings() {
  const { t, i18n } = useTranslation();

  const ALLOWED_DATE_FORMATS = [
    'dd/MM/yyyy',
    'MM/dd/yyyy',
    'yyyy/MM/dd',
    'dd.MM.yyyy',
    'dd-MM-yyyy',
    'yyyy-MM-dd',
    'EEEE, dd MMM yyyy',
  ];

  const validateNumberFormat = (pattern: string): boolean => {
    const patternRegex = /\{(\w+)(?::(\d+))?\}/g;
    const validKeys = ['year', 'month', 'day', 'number'];
    const requiredKeys = ['number'];

    let match: RegExpExecArray | null;
    const matches: RegExpExecArray[] = [];

    while ((match = patternRegex.exec(pattern)) !== null) {
      matches.push(match);
    }

    for (const key of requiredKeys) {
      if (!matches.some((m) => m[1] === key)) {
        return false;
      }
    }

    for (const match of matches) {
      const key = match[1];
      const padding = match[2];

      if (!validKeys.includes(key)) {
        return false;
      }

      if (padding !== undefined) {
        const paddingNum = Number.parseInt(padding, 10);
        if (Number.isNaN(paddingNum) || paddingNum < 0 || paddingNum > 20) {
          return false;
        }
      }
    }

    return true;
  };

  const companySchema = z.object({
    name: z
      .string({ required_error: t('settings.company.form.company.errors.required') })
      .min(1, t('settings.company.form.company.errors.empty'))
      .max(100, t('settings.company.form.company.errors.maxLength')),
    description: z.string().max(500, t('settings.company.form.description.errors.maxLength')),
    identifiers: z.record(z.string()).default({}),
    foundedAt: z
      .date()
      .refine((date) => date <= new Date(), t('settings.company.form.foundedAt.errors.future')),
    currency: z
      .string({ required_error: t('settings.company.form.currency.errors.required') })
      .min(1, t('settings.company.form.currency.errors.select')),
    address: z.string().min(1, t('settings.company.form.address.errors.empty')),
    postalCode: z.string().refine((val) => {
      return /^[0-9A-Z\s-]{3,10}$/.test(val);
    }, t('settings.company.form.postalCode.errors.format')),
    city: z.string().min(1, t('settings.company.form.city.errors.empty')),
    country: z.string().min(1, t('settings.company.form.country.errors.empty')),
    phone: z
      .string()
      .min(8, t('settings.company.form.phone.errors.minLength'))
      .refine((val) => {
        return /^[+]?[0-9\s\-()]{8,20}$/.test(val);
      }, t('settings.company.form.phone.errors.format')),
    email: z
      .string()
      .email()
      .min(1, t('settings.company.form.email.errors.required'))
      .refine((val) => {
        return z.string().email().safeParse(val).success;
      }, t('settings.company.form.email.errors.format')),
    quoteStartingNumber: z
      .number()
      .min(1, t('settings.company.form.quoteStartingNumber.errors.min')),
    quoteNumberFormat: z
      .string()
      .min(1, t('settings.company.form.quoteNumberFormat.errors.required'))
      .max(100, t('settings.company.form.quoteNumberFormat.errors.maxLength'))
      .refine((val) => {
        return validateNumberFormat(val);
      }, t('settings.company.form.quoteNumberFormat.errors.format')),
    invoiceStartingNumber: z
      .number()
      .min(1, t('settings.company.form.invoiceStartingNumber.errors.min')),
    invoiceNumberFormat: z
      .string()
      .min(1, t('settings.company.form.invoiceNumberFormat.errors.required'))
      .max(100, t('settings.company.form.invoiceNumberFormat.errors.maxLength'))
      .refine((val) => {
        return validateNumberFormat(val);
      }, t('settings.company.form.invoiceNumberFormat.errors.format')),
    receiptStartingNumber: z
      .number()
      .min(1, t('settings.company.form.receiptStartingNumber.errors.min')),
    receiptNumberFormat: z
      .string()
      .min(1, t('settings.company.form.receiptNumberFormat.errors.required'))
      .max(100, t('settings.company.form.receiptNumberFormat.errors.maxLength'))
      .refine((val) => {
        return validateNumberFormat(val);
      }, t('settings.company.form.receiptNumberFormat.errors.format')),
    invoicePDFFormat: z.string().refine((val) => {
      const validFormats = ['pdf', 'facturx', 'zugferd', 'xrechnung', 'ubl', 'cii'];
      return validFormats.includes(val.toLowerCase());
    }, t('settings.company.form.invoicePDFFormat.errors.format')),
    dateFormat: z
      .string()
      .min(1, t('settings.company.form.dateFormat.errors.required'))
      .max(50, t('settings.company.form.dateFormat.errors.maxLength'))
      .refine((val) => {
        return ALLOWED_DATE_FORMATS.includes(val);
      }, t('settings.company.form.dateFormat.errors.format')),
    exemptVat: z.boolean().optional(),
  });

  const { data } = useGet<Company>('/api/company/info');
  const { trigger } = usePost<Company>('/api/company/info');
  const [isLoading, setIsLoading] = useState(false);

  const form = useForm<z.infer<typeof companySchema>>({
    resolver: zodResolver(companySchema),
    defaultValues: {
      name: '',
      description: '',
      identifiers: {},
      exemptVat: false,
      foundedAt: new Date(),
      currency: '',
      address: '',
      postalCode: '',
      city: '',
      country: '',
      phone: '',
      email: '',
      invoicePDFFormat: '',
      quoteStartingNumber: 1,
      quoteNumberFormat: 'Q-{year}-{number}',
      invoiceStartingNumber: 1,
      invoiceNumberFormat: 'INV-{year}-{number}',
      receiptStartingNumber: 1,
      receiptNumberFormat: 'REC-{year}-{number}',
    },
  });

  // Watch country to fetch identifier config
  const selectedCountry = form.watch('country');
  const { identifiers: countryIdentifiers, vat: vatConfig } = useCountryIdentifiers(
    selectedCountry || undefined,
  );

  useEffect(() => {
    if (data && Object.keys(data).length > 0) {
      form.reset({
        ...data,
        foundedAt: new Date(data.foundedAt),
        exemptVat: !!data.exemptVat,
      });
    }
  }, [data, form]);

  async function onSubmit(values: z.infer<typeof companySchema>) {
    setIsLoading(true);
    trigger(values)
      .then(() => {
        toast.success(t('settings.company.messages.updateSuccess'));
      })
      .catch((error) => {
        console.error('Error updating company settings:', error);
        toast.error(t('settings.company.messages.updateError'));
      })
      .finally(() => {
        setIsLoading(false);
      });
  }

  const getDateFormatOption = (dateFormat: string) => {
    return `${format(new Date(), dateFormat)} - (${dateFormat})`;
  };

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-3xl font-bold">{t('settings.company.title')}</h1>
        <p className="text-muted-foreground">{t('settings.company.description')}</p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('settings.company.basicInfo')}</CardTitle>
              <CardDescription>{t('settings.company.basicInfoDescription')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>{t('settings.company.form.company.label')}</FormLabel>
                      <FormControl>
                        <Input
                          placeholder={t('settings.company.form.company.placeholder')}
                          {...field}
                          data-cy="company-name-input"
                        />
                      </FormControl>
                      <FormDescription>
                        {t('settings.company.form.company.description')}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('settings.company.form.description.label')}</FormLabel>
                      <FormControl>
                        <Input
                          placeholder={t('settings.company.form.description.placeholder')}
                          {...field}
                          data-cy="company-description-input"
                        />
                      </FormControl>
                      <FormDescription>
                        {t('settings.company.form.description.description')}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="foundedAt"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>{t('settings.company.form.foundedAt.label')}</FormLabel>
                      <FormControl>
                        <DatePicker
                          className="w-full bg-opacity-100"
                          value={field.value || null}
                          onChange={field.onChange}
                          placeholder={t('settings.company.form.foundedAt.placeholder')}
                          data-cy="company-foundedat-input"
                        />
                      </FormControl>
                      <FormDescription>
                        {t('settings.company.form.foundedAt.description')}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="currency"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>{t('settings.company.form.currency.label')}</FormLabel>
                      <FormControl>
                        <CurrencySelect
                          value={field.value}
                          onChange={(value) => field.onChange(value)}
                          data-cy="company-currency-select"
                        />
                      </FormControl>
                      <FormDescription>
                        {t('settings.company.form.currency.description')}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('settings.company.identifiers.title')}</CardTitle>
              <CardDescription>{t('settings.company.identifiers.description')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Dynamic identifiers for supported countries */}
                {countryIdentifiers.length > 0 ? (
                  <>
                    {countryIdentifiers.map((identifier) => (
                      <FormField
                        key={identifier.id}
                        control={form.control}
                        name={`identifiers.${identifier.id}`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel required={identifier.required}>
                              {t(identifier.labelKey)}
                            </FormLabel>
                            <FormControl>
                              <Input
                                placeholder={identifier.example || ''}
                                maxLength={identifier.maxLength || undefined}
                                {...field}
                                value={field.value || ''}
                                data-cy={`company-${identifier.id}-input`}
                              />
                            </FormControl>
                            {identifier.example && (
                              <FormDescription>
                                {t('settings.company.form.identifier.formatDescription', {
                                  example: identifier.example,
                                })}
                              </FormDescription>
                            )}
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    ))}
                    {/* VAT field for supported countries */}
                    <FormField
                      control={form.control}
                      name="identifiers.vat"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('identifiers.vat')}</FormLabel>
                          <FormControl>
                            <Input
                              placeholder={vatConfig.example || ''}
                              {...field}
                              value={field.value || ''}
                              data-cy="company-vat-input"
                            />
                          </FormControl>
                          {vatConfig.example && (
                            <FormDescription>
                              {t('settings.company.form.identifier.formatDescription', {
                                example: vatConfig.example,
                              })}
                            </FormDescription>
                          )}
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </>
                ) : (
                  <>
                    {/* Generic fields for unsupported countries */}
                    <FormField
                      control={form.control}
                      name="identifiers.legalId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('settings.company.form.legalId.label')}</FormLabel>
                          <FormControl>
                            <Input
                              placeholder={t('settings.company.form.legalId.placeholder')}
                              {...field}
                              value={field.value || ''}
                              data-cy="company-legalid-input"
                            />
                          </FormControl>
                          <FormDescription>
                            {t('settings.company.form.legalId.description')}
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="identifiers.vat"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('settings.company.form.vat.label')}</FormLabel>
                          <FormControl>
                            <Input
                              placeholder={t('settings.company.form.vat.placeholder')}
                              {...field}
                              value={field.value || ''}
                              data-cy="company-vat-input"
                            />
                          </FormControl>
                          <FormDescription>
                            {t('settings.company.form.vat.description')}
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('settings.company.address.title')}</CardTitle>
              <CardDescription>{t('settings.company.address.description')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <FormField
                control={form.control}
                name="address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>{t('settings.company.form.address.label')}</FormLabel>
                    <FormControl>
                      <Input
                        placeholder={t('settings.company.form.address.placeholder')}
                        {...field}
                        data-cy="company-address-input"
                      />
                    </FormControl>
                    <FormDescription>
                      {t('settings.company.form.address.description')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <FormField
                  control={form.control}
                  name="postalCode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>{t('settings.company.form.postalCode.label')}</FormLabel>
                      <FormControl>
                        <Input
                          placeholder={t('settings.company.form.postalCode.placeholder')}
                          {...field}
                          data-cy="company-postalcode-input"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="city"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>{t('settings.company.form.city.label')}</FormLabel>
                      <FormControl>
                        <Input
                          placeholder={t('settings.company.form.city.placeholder')}
                          {...field}
                          data-cy="company-city-input"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="country"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('settings.company.form.country.label')}</FormLabel>
                      <FormControl>
                        <Input
                          value={getCountryName(field.value, i18n.language)}
                          disabled
                          className="bg-muted cursor-not-allowed"
                          data-cy="company-country-input"
                        />
                      </FormControl>
                      <FormDescription>
                        {t('settings.company.form.country.readOnlyDescription')}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('settings.company.contact.title')}</CardTitle>
              <CardDescription>{t('settings.company.contact.description')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>{t('settings.company.form.phone.label')}</FormLabel>
                      <FormControl>
                        <Input
                          type="tel"
                          placeholder={t('settings.company.form.phone.placeholder')}
                          {...field}
                          data-cy="company-phone-input"
                        />
                      </FormControl>
                      <FormDescription>
                        {t('settings.company.form.phone.description')}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>{t('settings.company.form.email.label')}</FormLabel>
                      <FormControl>
                        <Input
                          type="email"
                          placeholder={t('settings.company.form.email.placeholder')}
                          {...field}
                          data-cy="company-email-input"
                        />
                      </FormControl>
                      <FormDescription>
                        {t('settings.company.form.email.description')}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('settings.company.numberFormats.title')}</CardTitle>
              <CardDescription>{t('settings.company.numberFormats.description')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <FormField
                    control={form.control}
                    name="quoteStartingNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel required>
                          {t('settings.company.form.quoteStartingNumber.label')}
                        </FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            placeholder={t('settings.company.form.quoteStartingNumber.placeholder')}
                            {...field}
                            onChange={(e) => field.onChange(Number(e.target.value))}
                            data-cy="company-quote-starting-number-input"
                          />
                        </FormControl>
                        <FormDescription>
                          {t('settings.company.form.quoteStartingNumber.description')}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="quoteNumberFormat"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel required>
                          {t('settings.company.form.quoteNumberFormat.label')}
                        </FormLabel>
                        <FormControl>
                          <Input
                            placeholder={t('settings.company.form.quoteNumberFormat.placeholder')}
                            {...field}
                            data-cy="company-quote-number-format-input"
                          />
                        </FormControl>
                        <FormDescription>
                          {t('settings.company.form.quoteNumberFormat.description')}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <FormField
                    control={form.control}
                    name="invoiceStartingNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel required>
                          {t('settings.company.form.invoiceStartingNumber.label')}
                        </FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            placeholder={t(
                              'settings.company.form.invoiceStartingNumber.placeholder',
                            )}
                            {...field}
                            onChange={(e) => field.onChange(Number(e.target.value))}
                            data-cy="company-invoice-starting-number-input"
                          />
                        </FormControl>
                        <FormDescription>
                          {t('settings.company.form.invoiceStartingNumber.description')}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="invoiceNumberFormat"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel required>
                          {t('settings.company.form.invoiceNumberFormat.label')}
                        </FormLabel>
                        <FormControl>
                          <Input
                            placeholder={t('settings.company.form.invoiceNumberFormat.placeholder')}
                            {...field}
                            data-cy="company-invoice-number-format-input"
                          />
                        </FormControl>
                        <FormDescription>
                          {t('settings.company.form.invoiceNumberFormat.description')}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <FormField
                    control={form.control}
                    name="receiptStartingNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel required>
                          {t('settings.company.form.receiptStartingNumber.label')}
                        </FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            placeholder={t(
                              'settings.company.form.receiptStartingNumber.placeholder',
                            )}
                            {...field}
                            onChange={(e) => field.onChange(Number(e.target.value))}
                            data-cy="company-receipt-starting-number-input"
                          />
                        </FormControl>
                        <FormDescription>
                          {t('settings.company.form.receiptStartingNumber.description')}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="receiptNumberFormat"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel required>
                          {t('settings.company.form.receiptNumberFormat.label')}
                        </FormLabel>
                        <FormControl>
                          <Input
                            placeholder={t('settings.company.form.receiptNumberFormat.placeholder')}
                            {...field}
                            data-cy="company-receipt-number-format-input"
                          />
                        </FormControl>
                        <FormDescription>
                          {t('settings.company.form.receiptNumberFormat.description')}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('settings.company.other.title')}</CardTitle>
              <CardDescription>{t('settings.company.other.description')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6 grid grid-cols-1 md:grid-cols-2 gap-6">
              <FormField
                control={form.control}
                name="invoicePDFFormat"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>
                      {t('settings.company.form.invoicePDFFormat.label')}
                    </FormLabel>
                    <FormControl>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <SelectTrigger className="w-full" data-cy="company-pdfformat-select">
                          <SelectValue
                            placeholder={t('settings.company.form.invoicePDFFormat.placeholder')}
                          />
                        </SelectTrigger>
                        <SelectContent data-cy="company-pdfformat-options">
                          <SelectItem value="pdf" data-cy="company-pdfformat-option-pdf">
                            {t('settings.company.form.invoicePDFFormat.options.pdf')}
                          </SelectItem>
                          <SelectItem value="facturx" data-cy="company-pdfformat-option-facturx">
                            {t('settings.company.form.invoicePDFFormat.options.facturx')}
                          </SelectItem>
                          <SelectItem value="zugferd" data-cy="company-pdfformat-option-zugferd">
                            {t('settings.company.form.invoicePDFFormat.options.zugferd')}
                          </SelectItem>
                          <SelectItem
                            value="xrechnung"
                            data-cy="company-pdfformat-option-xrechnung"
                          >
                            {t('settings.company.form.invoicePDFFormat.options.xrechnung')}
                          </SelectItem>
                          <SelectItem value="ubl" data-cy="company-pdfformat-option-ubl">
                            {t('settings.company.form.invoicePDFFormat.options.ubl')}
                          </SelectItem>
                          <SelectItem value="cii" data-cy="company-pdfformat-option-cii">
                            {t('settings.company.form.invoicePDFFormat.options.cii')}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormDescription>
                      {t('settings.company.form.invoicePDFFormat.description')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="dateFormat"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>{t('settings.company.form.dateFormat.label')}</FormLabel>
                    <FormControl>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <SelectTrigger className="w-full" data-cy="company-dateformat-select">
                          <SelectValue
                            placeholder={t('settings.company.form.dateFormat.placeholder')}
                          />
                        </SelectTrigger>
                        <SelectContent data-cy="company-dateformat-options">
                          {ALLOWED_DATE_FORMATS.map((format) => (
                            <SelectItem
                              key={format}
                              value={format}
                              data-cy={`company-dateformat-option-${format.replace(/\//g, '-')}`}
                            >
                              {getDateFormatOption(format)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormDescription>
                      {t('settings.company.form.dateFormat.description')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="exemptVat"
                render={({ field }) => (
                  <FormItem className="flex flex-col space-y-3">
                    <FormLabel>{t('settings.company.form.exemptVat.label')}</FormLabel>
                    <FormControl>
                      <Switch
                        checked={!!field.value}
                        onCheckedChange={(val) => field.onChange(val)}
                        data-cy="company-exemptvat-switch"
                      />
                    </FormControl>
                    <FormDescription>
                      {t('settings.company.form.exemptVat.description')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={isLoading}
              className="min-w-32"
              data-cy="company-submit-btn"
            >
              {isLoading
                ? t('settings.company.form.saving')
                : t('settings.company.form.saveSettings')}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
