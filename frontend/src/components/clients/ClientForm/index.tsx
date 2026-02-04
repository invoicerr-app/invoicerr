import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useCompany } from '@/contexts/company';
import { useGet, usePatch, usePost } from '@/hooks/use-fetch';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Form,
  FormControl,
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

interface ClientFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client?: any;
  onSuccess?: () => void;
}

export function ClientForm({ open, onOpenChange, client, onSuccess }: ClientFormProps) {
  const { t } = useTranslation();
  const { activeCompany } = useCompany();
  const isEdit = !!client;

  const [country, setCountry] = useState(activeCompany?.country || 'FR');

  const { data: complianceConfig } = useGet<any>(`/api/compliance/identifiers?country=${country}&entityType=client`);

  const clientSchema = z.object({
    name: z.string().min(1, 'Company name is required'),
    description: z.string().optional(),
    type: z.enum(['COMPANY', 'INDIVIDUAL']),
    contactEmail: z.string().email('Invalid email').min(1, 'Email is required'),
    contactFirstname: z.string().optional(),
    contactLastname: z.string().optional(),
    contactPhone: z.string().optional(),
    address: z.string().optional(),
    postalCode: z.string().optional(),
    city: z.string().optional(),
    country: z.string().default('FR'),
    currency: z.string().optional(),
    identifiers: z.record(z.string(), z.string()),
  });

  const { trigger: createTrigger } = usePost('/api/clients');
  const { trigger: updateTrigger } = usePatch(`/api/clients/${client?.id}`);

  const form = useForm<z.infer<typeof clientSchema>>({
    resolver: zodResolver(clientSchema),
    defaultValues: {
      name: '',
      description: '',
      type: 'COMPANY',
      contactEmail: '',
      contactFirstname: '',
      contactLastname: '',
      contactPhone: '',
      address: '',
      postalCode: '',
      city: '',
      country: activeCompany?.country || 'FR',
      currency: activeCompany?.currency,
      identifiers: {},
    },
  });

  useEffect(() => {
    if (isEdit && client) {
      form.reset({
        name: client.name || '',
        description: client.description || '',
        type: client.type || 'COMPANY',
        contactEmail: client.contactEmail || '',
        contactFirstname: client.contactFirstname || '',
        contactLastname: client.contactLastname || '',
        contactPhone: client.contactPhone || '',
        address: client.address || '',
        postalCode: client.postalCode || '',
        city: client.city || '',
        country: client.country || activeCompany?.country || 'FR',
        currency: client.currency || '',
        identifiers: client.identifiers || {},
      });
    } else {
      form.reset({
        name: '',
        description: '',
        type: 'COMPANY',
        contactEmail: '',
        contactFirstname: '',
        contactLastname: '',
        contactPhone: '',
        address: '',
        postalCode: '',
        city: '',
        country: activeCompany?.country || 'FR',
        currency: activeCompany?.currency,
        identifiers: {},
      });
    }
  }, [client, form, isEdit, activeCompany?.country, activeCompany?.currency]);

  const onSubmit = (data: z.infer<typeof clientSchema>) => {
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t(`clients.upsert.title.${isEdit ? 'edit' : 'create'}`)}</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('clients.upsert.fields.type.label')}</FormLabel>
                  <Select
                    value={field.value ?? 'COMPANY'}
                    onValueChange={(val) => field.onChange(val as any)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="COMPANY">{t('clients.upsert.fields.type.company')}</SelectItem>
                      <SelectItem value="INDIVIDUAL">{t('clients.upsert.fields.type.individual')}</SelectItem>
                    </SelectContent>
                  </Select>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('clients.upsert.fields.name.label')} *</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder={t('clients.upsert.fields.name.placeholder')} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="contactEmail"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('clients.upsert.fields.contactEmail.label')} *</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder={t('clients.upsert.fields.contactEmail.placeholder')} type="email" />
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
                  <FormLabel>{t('clients.upsert.fields.country.label')}</FormLabel>
                  <Select
                    value={field.value ?? 'FR'}
                    onValueChange={(val) => {
                      field.onChange(val as any);
                      setCountry(val);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="FR">France</SelectItem>
                      <SelectItem value="DE">Germany</SelectItem>
                      <SelectItem value="BE">Belgium</SelectItem>
                      <SelectItem value="IT">Italy</SelectItem>
                      <SelectItem value="ES">Spain</SelectItem>
                      <SelectItem value="PT">Portugal</SelectItem>
                      <SelectItem value="US">United States</SelectItem>
                      <SelectItem value="GB">United Kingdom</SelectItem>
                    </SelectContent>
                  </Select>
                </FormItem>
              )}
            />

            {complianceConfig?.identifiers && complianceConfig.identifiers.map((id: any) => (
              <FormField
                key={id.id}
                control={form.control}
                name={`identifiers.${id.id}`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t(`identifiers.${id.id}`) || id.labelKey}</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder={id.example} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ))}

            <div className="flex justify-end space-x-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t('clients.upsert.actions.cancel')}
              </Button>
              <Button type="submit">{t('clients.upsert.actions.save')}</Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
