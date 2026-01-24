import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { type Resolver, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import CountrySelect from '@/components/country-select';
import CurrencySelect from '@/components/currency-select';
import { DatePicker } from '@/components/date-picker';
import { StepIndicator } from '@/components/step-indicator';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { useCountryIdentifiers } from '@/hooks/use-compliance';
import { usePatch, usePost } from '@/hooks/use-fetch';
import type { Client } from '@/types';

interface ClientUpsertProps {
  client?: Client | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate?: (client: Client) => void;
}

interface ClientFormValues {
  type: 'COMPANY' | 'INDIVIDUAL';
  name: string;
  description: string;
  identifiers: Record<string, string | undefined>;
  currency: string | null;
  foundedAt?: Date;
  contactFirstname: string;
  contactLastname: string;
  contactPhone: string;
  contactEmail: string;
  address: string;
  postalCode: string;
  city: string;
  country: string;
}

export function ClientUpsert({ client, open, onOpenChange, onCreate }: ClientUpsertProps) {
  const { t } = useTranslation();
  const isEditing = !!client;
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const STEPS = [
    { id: 'type', label: t('clients.upsert.steps.type') },
    { id: 'identity', label: t('clients.upsert.steps.identity') },
    { id: 'address', label: t('clients.upsert.steps.address') },
    { id: 'identifiers', label: t('clients.upsert.steps.identifiers') },
    { id: 'contact', label: t('clients.upsert.steps.contact') },
  ];

  const { trigger: createClient } = usePost<Client>('/api/clients');
  const { trigger: updateClient } = usePatch<Client>(`/api/clients/${client?.id}`);

  const clientSchema = z
    .object({
      type: z.enum(['INDIVIDUAL', 'COMPANY']),
      name: z.string().optional(),
      description: z.string().max(500, t('clients.upsert.validation.description.maxLength')).optional(),
      identifiers: z.record(z.string().optional()).default({}),
      currency: z.string().nullable().optional(),
      foundedAt: z
        .date()
        .optional()
        .refine((date) => !date || date <= new Date(), t('clients.upsert.validation.foundedAt.future')),
      contactFirstname: z.string().optional(),
      contactLastname: z.string().optional(),
      contactPhone: z
        .string()
        .optional()
        .refine((val) => {
          if (!val) return true;
          return /^[+]?[0-9\s\-()]{8,20}$/.test(val);
        }, t('clients.upsert.validation.contactPhone.format')),
      contactEmail: z
        .string()
        .min(1, t('clients.upsert.validation.contactEmail.required'))
        .refine((val) => {
          if (!val) return true;
          return z.string().email().safeParse(val).success;
        }, t('clients.upsert.validation.contactEmail.format')),
      address: z.string().min(1, t('clients.upsert.validation.address.required')),
      postalCode: z.string().refine((val) => {
        return /^[0-9A-Z\s-]{3,10}$/.test(val);
      }, t('clients.upsert.validation.postalCode.format')),
      city: z.string().min(1, t('clients.upsert.validation.city.required')),
      country: z.string().min(1, t('clients.upsert.validation.country.required')),
    })
    .superRefine((val, ctx) => {
      if (val.type === 'INDIVIDUAL') {
        if (!val.contactFirstname || val.contactFirstname.trim() === '') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['contactFirstname'],
            message: t('clients.upsert.validation.contactFirstname.required'),
          });
        }
        if (!val.contactLastname || val.contactLastname.trim() === '') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['contactLastname'],
            message: t('clients.upsert.validation.contactLastname.required'),
          });
        }
      } else {
        if (!val.name || val.name.trim() === '') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['name'],
            message: t('clients.upsert.validation.name.required'),
          });
        }
      }
    });

  const form = useForm<ClientFormValues>({
    resolver: zodResolver(clientSchema) as Resolver<ClientFormValues>,
    defaultValues: {
      type: 'COMPANY',
      name: '',
      description: '',
      identifiers: {},
      currency: null,
      foundedAt: undefined,
      contactFirstname: '',
      contactLastname: '',
      contactPhone: '',
      contactEmail: '',
      address: '',
      postalCode: '',
      city: '',
      country: '',
    },
  });

  const clientType = form.watch('type');
  const selectedCountry = form.watch('country');

  const {
    identifiers: countryIdentifiers,
    vat: vatConfig,
    isLoading: identifiersLoading,
  } = useCountryIdentifiers(selectedCountry || undefined, 'client');

  useEffect(() => {
    if (isEditing && client) {
      form.reset({
        type: client.type || 'COMPANY',
        name: client.name || '',
        description: client.description || '',
        identifiers: client.identifiers || {},
        currency: client.currency || null,
        foundedAt: client.foundedAt ? new Date(client.foundedAt) : undefined,
        contactFirstname: client.contactFirstname || '',
        contactLastname: client.contactLastname || '',
        contactPhone: client.contactPhone || '',
        contactEmail: client.contactEmail || '',
        address: client.address || '',
        postalCode: client.postalCode || '',
        city: client.city || '',
        country: client.country || '',
      });
      // In edit mode, mark all steps as completed to allow navigation
      setCompletedSteps([0, 1, 2, 3, 4]);
    } else if (!isEditing && open) {
      form.reset({
        type: 'COMPANY',
        name: '',
        description: '',
        identifiers: {},
        currency: null,
        foundedAt: undefined,
        contactFirstname: '',
        contactLastname: '',
        contactPhone: '',
        contactEmail: '',
        address: '',
        postalCode: '',
        city: '',
        country: '',
      });
      setCurrentStepIndex(0);
      setCompletedSteps([]);
    }
  }, [client, isEditing, form, open]);

  const getStepFields = (stepIndex: number): (keyof ClientFormValues)[] => {
    switch (stepIndex) {
      case 0:
        return ['type', 'country'];
      case 1:
        return clientType === 'COMPANY' ? ['name', 'description'] : ['contactFirstname', 'contactLastname', 'description'];
      case 2:
        return ['address', 'postalCode', 'city'];
      case 3:
        return ['identifiers'];
      case 4:
        return ['contactEmail', 'contactPhone', 'currency', 'foundedAt'];
      default:
        return [];
    }
  };

  // Validate required identifiers based on country config
  const validateRequiredIdentifiers = (): boolean => {
    const identifiersValues = form.getValues('identifiers') || {};
    let isValid = true;

    // Clear all identifier errors first
    for (const identifier of countryIdentifiers) {
      form.clearErrors(`identifiers.${identifier.id}` as any);
    }
    form.clearErrors('identifiers.vat' as any);

    // Check each required identifier from country config
    for (const identifier of countryIdentifiers) {
      if (identifier.required) {
        const value = identifiersValues[identifier.id];
        if (!value || (typeof value === 'string' && value.trim() === '')) {
          form.setError(`identifiers.${identifier.id}` as any, {
            type: 'required',
            message: t('settings.company.form.identifier.errors.required'),
          });
          isValid = false;
        } else if (identifier.format) {
          try {
            const regex = new RegExp(identifier.format);
            if (!regex.test(value)) {
              form.setError(`identifiers.${identifier.id}` as any, {
                type: 'pattern',
                message: t('settings.company.form.identifier.errors.format', {
                  example: identifier.example || '',
                }),
              });
              isValid = false;
            }
          } catch {
            // Invalid regex, skip format validation
          }
        }
      }
    }

    return isValid;
  };

  const onSubmit = async (data: ClientFormValues) => {
    setIsLoading(true);
    const trigger = isEditing ? updateClient : createClient;

    try {
      // Clean up identifiers - remove undefined values
      const cleanedIdentifiers: Record<string, string> = {};
      for (const [key, value] of Object.entries(data.identifiers)) {
        if (value && typeof value === 'string' && value.trim() !== '') {
          cleanedIdentifiers[key] = value;
        }
      }

      const submitData = {
        ...data,
        identifiers: cleanedIdentifiers,
      };

      const createdClient = await trigger(submitData);
      if (!isEditing && onCreate && createdClient) {
        onCreate(createdClient);
      }
      onOpenChange(false);
      form.reset();
      setCurrentStepIndex(0);
      setCompletedSteps([]);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    form.reset();
    setCurrentStepIndex(0);
    setCompletedSteps([]);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="max-w-[95vw] lg:max-w-3xl max-h-[90dvh] flex flex-col overflow-hidden"
        dataCy="client-dialog"
      >
        <div className="flex-1 overflow-auto">
          <DialogHeader>
            <DialogTitle>{t(`clients.upsert.title.${isEditing ? 'edit' : 'create'}`)}</DialogTitle>
          </DialogHeader>

          <Form {...form}>
            <form
              onSubmit={(e) => {
                e.preventDefault();
              }}
              className="space-y-4 mt-4"
              data-cy="client-form"
            >
              <StepIndicator
                steps={STEPS}
                currentStep={currentStepIndex}
                completedSteps={completedSteps}
              />

              {/* Step 0: Type & Country */}
              {currentStepIndex === 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>{t('clients.upsert.steps.type')}</CardTitle>
                    <CardDescription>{t('clients.upsert.steps.typeDescription')}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <FormField
                        control={form.control}
                        name="type"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel required>{t('clients.upsert.fields.type.label')}</FormLabel>
                            <FormControl>
                              <Select value={field.value} onValueChange={field.onChange}>
                                <SelectTrigger data-cy="client-type-select">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="COMPANY" data-cy="client-type-company">
                                    {t('clients.upsert.fields.type.company')}
                                  </SelectItem>
                                  <SelectItem value="INDIVIDUAL" data-cy="client-type-individual">
                                    {t('clients.upsert.fields.type.individual')}
                                  </SelectItem>
                                </SelectContent>
                              </Select>
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
                            <FormLabel required>{t('clients.upsert.fields.country.label')}</FormLabel>
                            <FormControl>
                              <CountrySelect
                                value={field.value}
                                onChange={field.onChange}
                                data-cy="client-country-select"
                              />
                            </FormControl>
                            <FormDescription>
                              {t('clients.upsert.fields.country.description')}
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Step 1: Identity */}
              {currentStepIndex === 1 && (
                <Card>
                  <CardHeader>
                    <CardTitle>{t('clients.upsert.steps.identity')}</CardTitle>
                    <CardDescription>{t('clients.upsert.steps.identityDescription')}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {clientType === 'COMPANY' ? (
                      <FormField
                        control={form.control}
                        name="name"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel required>{t('clients.upsert.fields.name.label')}</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                placeholder={t('clients.upsert.fields.name.placeholder')}
                                data-cy="client-name-input"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <FormField
                          control={form.control}
                          name="contactFirstname"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel required>
                                {t('clients.upsert.fields.contactFirstname.label')}
                              </FormLabel>
                              <FormControl>
                                <Input
                                  {...field}
                                  placeholder={t('clients.upsert.fields.contactFirstname.placeholder')}
                                  data-cy="client-firstname-input"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="contactLastname"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel required>
                                {t('clients.upsert.fields.contactLastname.label')}
                              </FormLabel>
                              <FormControl>
                                <Input
                                  {...field}
                                  placeholder={t('clients.upsert.fields.contactLastname.placeholder')}
                                  data-cy="client-lastname-input"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                    )}

                    <FormField
                      control={form.control}
                      name="description"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('clients.upsert.fields.description.label')}</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              placeholder={t('clients.upsert.fields.description.placeholder')}
                              data-cy="client-description-input"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </CardContent>
                </Card>
              )}

              {/* Step 2: Address */}
              {currentStepIndex === 2 && (
                <Card>
                  <CardHeader>
                    <CardTitle>{t('clients.upsert.steps.address')}</CardTitle>
                    <CardDescription>{t('clients.upsert.steps.addressDescription')}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <FormField
                      control={form.control}
                      name="address"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel required>{t('clients.upsert.fields.address.label')}</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              placeholder={t('clients.upsert.fields.address.placeholder')}
                              data-cy="client-address-input"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <FormField
                        control={form.control}
                        name="postalCode"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel required>{t('clients.upsert.fields.postalCode.label')}</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                placeholder={t('clients.upsert.fields.postalCode.placeholder')}
                                data-cy="client-postalcode-input"
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
                            <FormLabel required>{t('clients.upsert.fields.city.label')}</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                placeholder={t('clients.upsert.fields.city.placeholder')}
                                data-cy="client-city-input"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Step 3: Identifiers */}
              {currentStepIndex === 3 && (
                <Card>
                  <CardHeader>
                    <CardTitle>{t('clients.upsert.steps.identifiers')}</CardTitle>
                    <CardDescription>{t('clients.upsert.steps.identifiersDescription')}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {identifiersLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                      </div>
                    ) : countryIdentifiers.length > 0 ? (
                      <>
                        {/* Required identifiers */}
                        {countryIdentifiers.filter((id) => id.required).length > 0 && (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {countryIdentifiers
                              .filter((identifier) => identifier.required)
                              .map((identifier) => (
                                <FormField
                                  key={identifier.id}
                                  control={form.control}
                                  name={`identifiers.${identifier.id}`}
                                  render={({ field }) => (
                                    <FormItem>
                                      <FormLabel required>{t(identifier.labelKey)}</FormLabel>
                                      <FormControl>
                                        <Input
                                          placeholder={identifier.example || ''}
                                          maxLength={identifier.maxLength || undefined}
                                          {...field}
                                          value={field.value ?? ''}
                                          data-cy={`client-${identifier.id}-input`}
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
                          </div>
                        )}

                        {/* Separator between required and optional */}
                        {countryIdentifiers.filter((id) => id.required).length > 0 &&
                          countryIdentifiers.filter((id) => !id.required).length > 0 && (
                            <div className="relative">
                              <div className="absolute inset-0 flex items-center">
                                <span className="w-full border-t" />
                              </div>
                              <div className="relative flex justify-center text-xs uppercase">
                                <span className="bg-card px-2 text-muted-foreground">
                                  {t('common.optional')}
                                </span>
                              </div>
                            </div>
                          )}

                        {/* Optional identifiers */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          {countryIdentifiers
                            .filter((identifier) => !identifier.required)
                            .map((identifier) => (
                              <FormField
                                key={identifier.id}
                                control={form.control}
                                name={`identifiers.${identifier.id}`}
                                render={({ field }) => (
                                  <FormItem>
                                    <FormLabel>{t(identifier.labelKey)}</FormLabel>
                                    <FormControl>
                                      <Input
                                        placeholder={identifier.example || ''}
                                        maxLength={identifier.maxLength || undefined}
                                        {...field}
                                        value={field.value ?? ''}
                                        data-cy={`client-${identifier.id}-input`}
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
                          {/* VAT field - always shown */}
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
                                    data-cy="client-vat-input"
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
                        </div>
                      </>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Generic fields for unsupported countries */}
                        <FormField
                          control={form.control}
                          name="identifiers.legalId"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>{t('clients.upsert.fields.legalId.label')}</FormLabel>
                              <FormControl>
                                <Input
                                  placeholder={t('clients.upsert.fields.legalId.placeholder')}
                                  {...field}
                                  value={field.value || ''}
                                  data-cy="client-legalid-input"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="identifiers.vat"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>{t('clients.upsert.fields.vat.label')}</FormLabel>
                              <FormControl>
                                <Input
                                  placeholder={t('clients.upsert.fields.vat.placeholder')}
                                  {...field}
                                  value={field.value || ''}
                                  data-cy="client-vat-input"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Step 4: Contact */}
              {currentStepIndex === 4 && (
                <Card>
                  <CardHeader>
                    <CardTitle>{t('clients.upsert.steps.contact')}</CardTitle>
                    <CardDescription>{t('clients.upsert.steps.contactDescription')}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <FormField
                        control={form.control}
                        name="contactEmail"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel required>{t('clients.upsert.fields.contactEmail.label')}</FormLabel>
                            <FormControl>
                              <Input
                                type="email"
                                {...field}
                                placeholder={t('clients.upsert.fields.contactEmail.placeholder')}
                                data-cy="client-email-input"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="contactPhone"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t('clients.upsert.fields.contactPhone.label')}</FormLabel>
                            <FormControl>
                              <Input
                                type="tel"
                                {...field}
                                placeholder={t('clients.upsert.fields.contactPhone.placeholder')}
                                data-cy="client-phone-input"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <FormField
                        control={form.control}
                        name="currency"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t('clients.upsert.fields.currency.label')}</FormLabel>
                            <FormControl>
                              <CurrencySelect
                                value={field.value}
                                onChange={field.onChange}
                                data-cy="client-currency-select"
                              />
                            </FormControl>
                            <FormDescription>
                              {t('clients.upsert.fields.currency.description')}
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
                            <FormLabel>{t('clients.upsert.fields.foundedAt.label')}</FormLabel>
                            <FormControl>
                              <DatePicker
                                className="w-full"
                                value={field.value || null}
                                onChange={field.onChange}
                                placeholder={t('clients.upsert.fields.foundedAt.placeholder')}
                                data-cy="client-foundedat-input"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Navigation buttons */}
              <div className="flex justify-between gap-4 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  disabled={currentStepIndex === 0 || isLoading}
                  onClick={() => setCurrentStepIndex(currentStepIndex - 1)}
                  data-cy="client-prev-btn"
                >
                  {t('common.previous')}
                </Button>

                {currentStepIndex < STEPS.length - 1 ? (
                  <Button
                    type="button"
                    onClick={async (e) => {
                      e.preventDefault();
                      const stepFields = getStepFields(currentStepIndex);
                      let isValid = await form.trigger(stepFields as any);

                      // For identifiers step, also validate required identifiers from country config
                      if (currentStepIndex === 3 && isValid) {
                        isValid = validateRequiredIdentifiers();
                      }

                      if (isValid) {
                        setCompletedSteps([...completedSteps, currentStepIndex]);
                        setCurrentStepIndex(currentStepIndex + 1);
                      }
                    }}
                    disabled={isLoading || (currentStepIndex === 3 && identifiersLoading)}
                    data-cy="client-next-btn"
                  >
                    {t('common.next')}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    disabled={isLoading}
                    onClick={async (e) => {
                      e.preventDefault();
                      const stepFields = getStepFields(currentStepIndex);
                      const isValid = await form.trigger(stepFields as any);
                      if (isValid) {
                        form.handleSubmit(onSubmit)();
                      }
                    }}
                    data-cy="client-submit-btn"
                  >
                    {isLoading
                      ? t('common.loading')
                      : isEditing
                        ? t('clients.upsert.actions.save')
                        : t('clients.upsert.actions.create')}
                  </Button>
                )}
              </div>
            </form>
          </Form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
