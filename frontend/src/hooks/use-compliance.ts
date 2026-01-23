import { useCallback, useMemo } from 'react';
import { useGet } from './use-fetch';

/**
 * VAT Rate definition
 */
export interface VATRate {
  code: string;
  rate: number;
  labelKey: string;
  category?: string;
}

/**
 * VAT Exemption definition
 */
export interface VATExemption {
  code: string;
  article: string;
  labelKey: string;
  ublCode?: string;
}

/**
 * Identifier definition
 */
export interface IdentifierDefinition {
  id: string;
  labelKey: string;
  format: string;
  required: boolean;
  maxLength?: number;
}

/**
 * Custom field definition
 */
export interface CustomFieldDefinition {
  id: string;
  labelKey: string;
  type: 'string' | 'number' | 'date' | 'select' | 'boolean';
  required: boolean;
  format?: string;
  options?: Array<{ value: string; labelKey: string }>;
}

/**
 * Transmission rules
 */
export interface TransmissionRules {
  method: string;
  mandatory: boolean;
  platform: string | null;
  async: boolean;
  deadlineDays: number | null;
  labelKey: string;
  icon: string;
}

/**
 * Format rules
 */
export interface FormatRules {
  preferred: string;
  supported: string[];
  xmlSyntax: string;
}

/**
 * Numbering config
 */
export interface NumberingConfig {
  seriesRequired: boolean;
  hashChaining: boolean;
  gapAllowed: boolean;
  resetPeriod: 'never' | 'yearly' | 'monthly';
}

/**
 * Correction code
 */
export interface CorrectionCode {
  code: string;
  labelKey: string;
  ublTypeCode?: string;
}

/**
 * Compliance configuration from API
 */
export interface ComplianceConfig {
  vatRates: VATRate[];
  defaultVatRate: number;
  reverseCharge: boolean;
  reverseChargeTextKey: string | null;
  exemptions: VATExemption[];
  requiredFields: {
    invoice: string[];
    client: string[];
  };
  identifierFormats: Record<string, string>;
  vatNumberFormat: string | null;
  format: FormatRules;
  transmission: TransmissionRules;
  numbering: NumberingConfig;
  legalMentionKeys: string[];
  identifiers: {
    company: IdentifierDefinition[];
    client: IdentifierDefinition[];
  };
  customFields: CustomFieldDefinition[];
  qrCodeRequired: boolean;
  signatureRequired: boolean;
  hashChainRequired: boolean;
  correctionCodes: CorrectionCode[];
}

/**
 * Country summary
 */
export interface CountrySummary {
  code: string;
  name?: string;
  currency: string;
  isEU: boolean;
}

/**
 * Hook parameters
 */
export interface UseComplianceParams {
  supplierCountry: string;
  customerCountry?: string | null;
  transactionType?: 'B2B' | 'B2G' | 'B2C';
  nature?: 'goods' | 'services' | 'mixed';
}

/**
 * Hook return type
 */
export interface UseComplianceReturn {
  config: ComplianceConfig | null;
  isLoading: boolean;
  error: Error | null;
  // Convenience getters
  vatRates: VATRate[];
  defaultVatRate: number;
  isReverseCharge: boolean;
  requiredInvoiceFields: string[];
  requiredClientFields: string[];
  companyIdentifiers: IdentifierDefinition[];
  clientIdentifiers: IdentifierDefinition[];
  customFields: CustomFieldDefinition[];
  transmissionMethod: string;
  transmissionMandatory: boolean;
  legalMentions: string[];
  // Validation helpers
  validateVATNumber: (vat: string) => boolean;
  validateIdentifier: (id: string, value: string) => boolean;
  isFieldRequired: (field: string, type: 'invoice' | 'client') => boolean;
  // Refetch
  refetch: () => void;
}

/**
 * Hook to fetch and use compliance configuration
 */
export function useCompliance(params: UseComplianceParams): UseComplianceReturn {
  const { supplierCountry, customerCountry, transactionType = 'B2B', nature = 'services' } = params;

  // Build URL with query params
  const url = useMemo(() => {
    const searchParams = new URLSearchParams({
      supplierCountry,
      transactionType,
      nature,
    });
    if (customerCountry) {
      searchParams.set('customerCountry', customerCountry);
    }
    return `/compliance/config?${searchParams.toString()}`;
  }, [supplierCountry, customerCountry, transactionType, nature]);

  const {
    data: config,
    loading: isLoading,
    error,
    mutate: refetch,
  } = useGet<ComplianceConfig>(url);

  // Convenience getters with default values
  const vatRates = config?.vatRates || [];
  const defaultVatRate = config?.defaultVatRate || 20;
  const isReverseCharge = config?.reverseCharge || false;
  const requiredInvoiceFields = config?.requiredFields?.invoice || [];
  const requiredClientFields = config?.requiredFields?.client || [];
  const companyIdentifiers = config?.identifiers?.company || [];
  const clientIdentifiers = config?.identifiers?.client || [];
  const customFields = config?.customFields || [];
  const transmissionMethod = config?.transmission?.method || 'email';
  const transmissionMandatory = config?.transmission?.mandatory || false;
  const legalMentions = config?.legalMentionKeys || [];

  // Validation helpers
  const validateVATNumber = useCallback(
    (vat: string): boolean => {
      if (!config?.vatNumberFormat) return true;
      try {
        const regex = new RegExp(config.vatNumberFormat);
        return regex.test(vat);
      } catch {
        return true;
      }
    },
    [config?.vatNumberFormat],
  );

  const validateIdentifier = useCallback(
    (id: string, value: string): boolean => {
      const format = config?.identifierFormats?.[id];
      if (!format) return true;
      try {
        const regex = new RegExp(format);
        return regex.test(value);
      } catch {
        return true;
      }
    },
    [config?.identifierFormats],
  );

  const isFieldRequired = useCallback(
    (field: string, type: 'invoice' | 'client'): boolean => {
      const fields = type === 'invoice' ? requiredInvoiceFields : requiredClientFields;
      return fields.includes(field);
    },
    [requiredInvoiceFields, requiredClientFields],
  );

  return {
    config,
    isLoading,
    error,
    vatRates,
    defaultVatRate,
    isReverseCharge,
    requiredInvoiceFields,
    requiredClientFields,
    companyIdentifiers,
    clientIdentifiers,
    customFields,
    transmissionMethod,
    transmissionMandatory,
    legalMentions,
    validateVATNumber,
    validateIdentifier,
    isFieldRequired,
    refetch,
  };
}

/**
 * Hook to fetch list of supported countries
 */
export function useComplianceCountries() {
  const { data, loading, error, mutate } = useGet<CountrySummary[]>('/compliance/countries');

  return {
    countries: data || [],
    isLoading: loading,
    error,
    refetch: mutate,
  };
}

/**
 * Hook to fetch supported transmission platforms
 */
export function useCompliancePlatforms() {
  const { data, loading, error, mutate } = useGet<string[]>('/compliance/platforms');

  return {
    platforms: data || [],
    isLoading: loading,
    error,
    refetch: mutate,
  };
}

/**
 * Hook to fetch correction codes for a country
 */
export function useCorrectionCodes(country: string) {
  const url = useMemo(() => `/compliance/correction-codes?country=${country}`, [country]);
  const { data, loading, error, mutate } = useGet<CorrectionCode[]>(url);

  return {
    codes: data || [],
    isLoading: loading,
    error,
    refetch: mutate,
  };
}

/**
 * Single identifier field config
 */
export interface IdentifierFieldConfig {
  id: string;
  labelKey: string;
  format: string;
  example: string | null;
  required: boolean;
  maxLength: number | null;
}

/**
 * VAT field config
 */
export interface VATFieldConfig {
  labelKey: string | null;
  format: string | null;
  example: string | null;
}

/**
 * Country identifier config response
 */
export interface CountryIdentifierConfig {
  identifiers: IdentifierFieldConfig[];
  vat: VATFieldConfig;
}

/**
 * Hook to fetch identifier config for a country (for onboarding)
 * Returns empty identifiers array for unsupported countries
 */
export function useCountryIdentifiers(country: string | undefined) {
  const url = useMemo(
    () => (country ? `/api/compliance/identifiers?country=${country}` : null),
    [country],
  );

  const { data, loading, error, mutate } = useGet<CountryIdentifierConfig>(url);

  return {
    identifiers: data?.identifiers || [],
    vat: data?.vat || { labelKey: null, format: null, example: null },
    isLoading: loading,
    error,
    refetch: mutate,
  };
}
