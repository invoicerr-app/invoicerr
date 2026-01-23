'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
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
import { Textarea } from '@/components/ui/textarea';
import { useGet, usePatch } from '@/hooks/use-fetch';
import { ChevronDown, ChevronRight, CheckCircle2, Circle } from 'lucide-react';

interface ComplianceSettingsResponse {
  configured: boolean;
  companyId?: string;

  // Chorus Pro
  chorusApiUrl: string | null;
  chorusClientId: string | null;
  chorusClientSecretSet: boolean;
  chorusTechnicalAccountId: string | null;

  // PDP
  pdpApiUrl: string | null;
  pdpApiKeySet: boolean;
  pdpClientId: string | null;
  pdpProvider: string | null;

  // Peppol
  peppolAccessPointUrl: string | null;
  peppolSenderId: string | null;
  peppolCertificateSet: boolean;
  peppolPrivateKeySet: boolean;
  peppolEnvironment: string | null;

  // SdI
  sdiApiUrl: string | null;
  sdiCertificateSet: boolean;
  sdiPrivateKeySet: boolean;

  // Verifactu
  verifactuApiUrl: string | null;
  verifactuCertificateSet: boolean;
  verifactuPrivateKeySet: boolean;
  verifactuNif: string | null;

  // SAF-T
  saftSoftwareCertificateNumber: string | null;
  saftHashValidationKeySet: boolean;

  // General
  defaultTransmissionPlatform: string | null;
  enableAutoTransmission: boolean;
}

interface ComplianceSettingsForm {
  // Chorus Pro
  chorusApiUrl: string;
  chorusClientId: string;
  chorusClientSecret: string;
  chorusTechnicalAccountId: string;

  // PDP
  pdpApiUrl: string;
  pdpApiKey: string;
  pdpClientId: string;
  pdpProvider: string;

  // Peppol
  peppolAccessPointUrl: string;
  peppolSenderId: string;
  peppolCertificatePem: string;
  peppolPrivateKeyPem: string;
  peppolEnvironment: string;

  // SdI
  sdiApiUrl: string;
  sdiCertificatePem: string;
  sdiPrivateKeyPem: string;
  sdiCertificatePassword: string;

  // Verifactu
  verifactuApiUrl: string;
  verifactuCertificatePem: string;
  verifactuPrivateKeyPem: string;
  verifactuNif: string;

  // SAF-T
  saftSoftwareCertificateNumber: string;
  saftHashValidationKey: string;

  // General
  defaultTransmissionPlatform: string;
  enableAutoTransmission: boolean;
}

interface PlatformSectionProps {
  title: string;
  description: string;
  isConfigured: boolean;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

function PlatformSection({
  title,
  description,
  isConfigured,
  children,
  defaultOpen = false,
}: PlatformSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {isConfigured ? (
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                ) : (
                  <Circle className="h-5 w-5 text-muted-foreground" />
                )}
                <div>
                  <CardTitle className="text-lg">{title}</CardTitle>
                  <CardDescription>{description}</CardDescription>
                </div>
              </div>
              {isOpen ? (
                <ChevronDown className="h-5 w-5 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-5 w-5 text-muted-foreground" />
              )}
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0">{children}</CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

export default function ComplianceSettings() {
  const { t } = useTranslation();
  const { data: settings, mutate } = useGet<ComplianceSettingsResponse>(
    '/api/compliance/settings'
  );
  const { data: platforms } = useGet<{ platforms: string[] }>(
    '/api/compliance/settings/platforms'
  );
  const { trigger: updateSettings, loading: saving } = usePatch<{
    success: boolean;
  }>('/api/compliance/settings');

  const form = useForm<ComplianceSettingsForm>({
    defaultValues: {
      chorusApiUrl: '',
      chorusClientId: '',
      chorusClientSecret: '',
      chorusTechnicalAccountId: '',
      pdpApiUrl: '',
      pdpApiKey: '',
      pdpClientId: '',
      pdpProvider: '',
      peppolAccessPointUrl: '',
      peppolSenderId: '',
      peppolCertificatePem: '',
      peppolPrivateKeyPem: '',
      peppolEnvironment: 'test',
      sdiApiUrl: '',
      sdiCertificatePem: '',
      sdiPrivateKeyPem: '',
      sdiCertificatePassword: '',
      verifactuApiUrl: '',
      verifactuCertificatePem: '',
      verifactuPrivateKeyPem: '',
      verifactuNif: '',
      saftSoftwareCertificateNumber: '',
      saftHashValidationKey: '',
      defaultTransmissionPlatform: 'email',
      enableAutoTransmission: false,
    },
  });

  useEffect(() => {
    if (settings?.configured) {
      form.reset({
        chorusApiUrl: settings.chorusApiUrl || '',
        chorusClientId: settings.chorusClientId || '',
        chorusClientSecret: '', // Don't populate secrets
        chorusTechnicalAccountId: settings.chorusTechnicalAccountId || '',
        pdpApiUrl: settings.pdpApiUrl || '',
        pdpApiKey: '', // Don't populate secrets
        pdpClientId: settings.pdpClientId || '',
        pdpProvider: settings.pdpProvider || '',
        peppolAccessPointUrl: settings.peppolAccessPointUrl || '',
        peppolSenderId: settings.peppolSenderId || '',
        peppolCertificatePem: '', // Don't populate certificates
        peppolPrivateKeyPem: '', // Don't populate private keys
        peppolEnvironment: settings.peppolEnvironment || 'test',
        sdiApiUrl: settings.sdiApiUrl || '',
        sdiCertificatePem: '',
        sdiPrivateKeyPem: '',
        sdiCertificatePassword: '',
        verifactuApiUrl: settings.verifactuApiUrl || '',
        verifactuCertificatePem: '',
        verifactuPrivateKeyPem: '',
        verifactuNif: settings.verifactuNif || '',
        saftSoftwareCertificateNumber: settings.saftSoftwareCertificateNumber || '',
        saftHashValidationKey: '',
        defaultTransmissionPlatform: settings.defaultTransmissionPlatform || 'email',
        enableAutoTransmission: settings.enableAutoTransmission || false,
      });
    }
  }, [settings, form]);

  const onSubmit = async (data: ComplianceSettingsForm) => {
    // Only send non-empty values
    const payload: Record<string, any> = {};
    Object.entries(data).forEach(([key, value]) => {
      if (value !== '' && value !== undefined && value !== null) {
        payload[key] = value;
      }
    });

    try {
      const result = await updateSettings(payload);
      if (result?.success) {
        toast.success(t('settings.compliance.messages.saveSuccess'));
        mutate();
      }
    } catch (error) {
      console.error('Error saving compliance settings:', error);
      toast.error(t('settings.compliance.messages.saveError'));
    }
  };

  const isChorusConfigured =
    settings?.chorusApiUrl &&
    settings?.chorusClientId &&
    settings?.chorusClientSecretSet &&
    settings?.chorusTechnicalAccountId;

  const isPdpConfigured =
    settings?.pdpApiUrl && settings?.pdpApiKeySet && settings?.pdpClientId;

  const isPeppolConfigured =
    settings?.peppolAccessPointUrl && settings?.peppolSenderId;

  const isSdiConfigured =
    settings?.sdiApiUrl && settings?.sdiCertificateSet && settings?.sdiPrivateKeySet;

  const isVerifactuConfigured =
    settings?.verifactuApiUrl &&
    settings?.verifactuCertificateSet &&
    settings?.verifactuPrivateKeySet &&
    settings?.verifactuNif;

  const isSaftConfigured =
    settings?.saftSoftwareCertificateNumber && settings?.saftHashValidationKeySet;

  return (
    <div className="h-full">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">{t('settings.compliance.title')}</h1>
        <p className="text-muted-foreground">{t('settings.compliance.description')}</p>
      </div>

      {platforms?.platforms && platforms.platforms.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-sm">
              {t('settings.compliance.configuredPlatforms')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {platforms.platforms.map((platform) => (
                <span
                  key={platform}
                  className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm"
                >
                  {platform}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          {/* General Settings */}
          <Card>
            <CardHeader>
              <CardTitle>{t('settings.compliance.general.title')}</CardTitle>
              <CardDescription>
                {t('settings.compliance.general.description')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="defaultTransmissionPlatform"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t('settings.compliance.general.defaultPlatform')}
                    </FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="email">Email</SelectItem>
                        <SelectItem value="chorus">Chorus Pro</SelectItem>
                        <SelectItem value="pdp">PDP</SelectItem>
                        <SelectItem value="peppol">Peppol</SelectItem>
                        <SelectItem value="sdi">SdI</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="enableAutoTransmission"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base">
                        {t('settings.compliance.general.autoTransmission')}
                      </FormLabel>
                      <FormDescription>
                        {t('settings.compliance.general.autoTransmissionDescription')}
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {/* Chorus Pro (France B2G) */}
          <PlatformSection
            title={t('settings.compliance.chorus.title')}
            description={t('settings.compliance.chorus.description')}
            isConfigured={!!isChorusConfigured}
          >
            <div className="space-y-4">
              <FormField
                control={form.control}
                name="chorusApiUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('settings.compliance.chorus.apiUrl')}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="https://chorus-pro.gouv.fr/api"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="chorusClientId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('settings.compliance.chorus.clientId')}</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="chorusClientSecret"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t('settings.compliance.chorus.clientSecret')}
                      {settings?.chorusClientSecretSet && (
                        <span className="ml-2 text-xs text-green-600">
                          ({t('settings.compliance.secretSet')})
                        </span>
                      )}
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="password"
                        placeholder={
                          settings?.chorusClientSecretSet
                            ? '••••••••••••'
                            : undefined
                        }
                      />
                    </FormControl>
                    <FormDescription>
                      {t('settings.compliance.leaveBlankToKeep')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="chorusTechnicalAccountId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t('settings.compliance.chorus.technicalAccountId')}
                    </FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </PlatformSection>

          {/* PDP (France B2B) */}
          <PlatformSection
            title={t('settings.compliance.pdp.title')}
            description={t('settings.compliance.pdp.description')}
            isConfigured={!!isPdpConfigured}
          >
            <div className="space-y-4">
              <FormField
                control={form.control}
                name="pdpApiUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('settings.compliance.pdp.apiUrl')}</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="https://api.pdp-provider.fr" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="pdpClientId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('settings.compliance.pdp.clientId')}</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="pdpApiKey"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t('settings.compliance.pdp.apiKey')}
                      {settings?.pdpApiKeySet && (
                        <span className="ml-2 text-xs text-green-600">
                          ({t('settings.compliance.secretSet')})
                        </span>
                      )}
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="password"
                        placeholder={
                          settings?.pdpApiKeySet ? '••••••••••••' : undefined
                        }
                      />
                    </FormControl>
                    <FormDescription>
                      {t('settings.compliance.leaveBlankToKeep')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="pdpProvider"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('settings.compliance.pdp.provider')}</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="e.g., Pennylane, Sage..." />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </PlatformSection>

          {/* Peppol */}
          <PlatformSection
            title={t('settings.compliance.peppol.title')}
            description={t('settings.compliance.peppol.description')}
            isConfigured={!!isPeppolConfigured}
          >
            <div className="space-y-4">
              <FormField
                control={form.control}
                name="peppolAccessPointUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t('settings.compliance.peppol.accessPointUrl')}
                    </FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="https://ap.peppol-provider.eu" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="peppolSenderId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('settings.compliance.peppol.senderId')}</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="0088:1234567890123" />
                    </FormControl>
                    <FormDescription>
                      {t('settings.compliance.peppol.senderIdDescription')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="peppolEnvironment"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t('settings.compliance.peppol.environment')}
                    </FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="test">Test</SelectItem>
                        <SelectItem value="production">Production</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="peppolCertificatePem"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t('settings.compliance.peppol.certificate')}
                      {settings?.peppolCertificateSet && (
                        <span className="ml-2 text-xs text-green-600">
                          ({t('settings.compliance.secretSet')})
                        </span>
                      )}
                    </FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        placeholder="-----BEGIN CERTIFICATE-----"
                        className="font-mono text-xs"
                        rows={4}
                      />
                    </FormControl>
                    <FormDescription>
                      {t('settings.compliance.leaveBlankToKeep')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="peppolPrivateKeyPem"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t('settings.compliance.peppol.privateKey')}
                      {settings?.peppolPrivateKeySet && (
                        <span className="ml-2 text-xs text-green-600">
                          ({t('settings.compliance.secretSet')})
                        </span>
                      )}
                    </FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        placeholder="-----BEGIN PRIVATE KEY-----"
                        className="font-mono text-xs"
                        rows={4}
                      />
                    </FormControl>
                    <FormDescription>
                      {t('settings.compliance.leaveBlankToKeep')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </PlatformSection>

          {/* SdI (Italy) */}
          <PlatformSection
            title={t('settings.compliance.sdi.title')}
            description={t('settings.compliance.sdi.description')}
            isConfigured={!!isSdiConfigured}
          >
            <div className="space-y-4">
              <FormField
                control={form.control}
                name="sdiApiUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('settings.compliance.sdi.apiUrl')}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="https://ivaservizi.agenziaentrate.gov.it"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="sdiCertificatePem"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t('settings.compliance.sdi.certificate')}
                      {settings?.sdiCertificateSet && (
                        <span className="ml-2 text-xs text-green-600">
                          ({t('settings.compliance.secretSet')})
                        </span>
                      )}
                    </FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        placeholder="-----BEGIN CERTIFICATE-----"
                        className="font-mono text-xs"
                        rows={4}
                      />
                    </FormControl>
                    <FormDescription>
                      {t('settings.compliance.leaveBlankToKeep')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="sdiPrivateKeyPem"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t('settings.compliance.sdi.privateKey')}
                      {settings?.sdiPrivateKeySet && (
                        <span className="ml-2 text-xs text-green-600">
                          ({t('settings.compliance.secretSet')})
                        </span>
                      )}
                    </FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        placeholder="-----BEGIN PRIVATE KEY-----"
                        className="font-mono text-xs"
                        rows={4}
                      />
                    </FormControl>
                    <FormDescription>
                      {t('settings.compliance.leaveBlankToKeep')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="sdiCertificatePassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t('settings.compliance.sdi.certificatePassword')}
                    </FormLabel>
                    <FormControl>
                      <Input {...field} type="password" />
                    </FormControl>
                    <FormDescription>
                      {t('settings.compliance.sdi.certificatePasswordDescription')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </PlatformSection>

          {/* Verifactu (Spain) */}
          <PlatformSection
            title={t('settings.compliance.verifactu.title')}
            description={t('settings.compliance.verifactu.description')}
            isConfigured={!!isVerifactuConfigured}
          >
            <div className="space-y-4">
              <FormField
                control={form.control}
                name="verifactuApiUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('settings.compliance.verifactu.apiUrl')}</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="https://www2.agenciatributaria.gob.es"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="verifactuNif"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('settings.compliance.verifactu.nif')}</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="B12345678" />
                    </FormControl>
                    <FormDescription>
                      {t('settings.compliance.verifactu.nifDescription')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="verifactuCertificatePem"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t('settings.compliance.verifactu.certificate')}
                      {settings?.verifactuCertificateSet && (
                        <span className="ml-2 text-xs text-green-600">
                          ({t('settings.compliance.secretSet')})
                        </span>
                      )}
                    </FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        placeholder="-----BEGIN CERTIFICATE-----"
                        className="font-mono text-xs"
                        rows={4}
                      />
                    </FormControl>
                    <FormDescription>
                      {t('settings.compliance.leaveBlankToKeep')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="verifactuPrivateKeyPem"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t('settings.compliance.verifactu.privateKey')}
                      {settings?.verifactuPrivateKeySet && (
                        <span className="ml-2 text-xs text-green-600">
                          ({t('settings.compliance.secretSet')})
                        </span>
                      )}
                    </FormLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        placeholder="-----BEGIN PRIVATE KEY-----"
                        className="font-mono text-xs"
                        rows={4}
                      />
                    </FormControl>
                    <FormDescription>
                      {t('settings.compliance.leaveBlankToKeep')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </PlatformSection>

          {/* SAF-T (Portugal) */}
          <PlatformSection
            title={t('settings.compliance.saft.title')}
            description={t('settings.compliance.saft.description')}
            isConfigured={!!isSaftConfigured}
          >
            <div className="space-y-4">
              <FormField
                control={form.control}
                name="saftSoftwareCertificateNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t('settings.compliance.saft.softwareCertificateNumber')}
                    </FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormDescription>
                      {t('settings.compliance.saft.softwareCertificateDescription')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="saftHashValidationKey"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t('settings.compliance.saft.hashValidationKey')}
                      {settings?.saftHashValidationKeySet && (
                        <span className="ml-2 text-xs text-green-600">
                          ({t('settings.compliance.secretSet')})
                        </span>
                      )}
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="password"
                        placeholder={
                          settings?.saftHashValidationKeySet
                            ? '••••••••••••'
                            : undefined
                        }
                      />
                    </FormControl>
                    <FormDescription>
                      {t('settings.compliance.leaveBlankToKeep')}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </PlatformSection>

          <div className="flex justify-end pt-4">
            <Button type="submit" disabled={saving} loading={saving}>
              {t('settings.compliance.saveButton')}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
