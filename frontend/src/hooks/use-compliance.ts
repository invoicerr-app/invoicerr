import { useCallback, useEffect, useMemo, useState } from 'react';
import { authenticatedFetch, useGet } from './use-fetch';

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

// ============================================================================
// In-memory cache for compliance configs (5 hour TTL, resets on page reload)
// ============================================================================
const CACHE_TTL_MS = 5 * 60 * 60 * 1000; // 5 hours

const complianceCache = new Map<string, { data: ComplianceConfig; timestamp: number }>();
const identifierCache = new Map<string, { data: CountryIdentifierConfig; timestamp: number }>();

function getCachedCompliance(key: string): ComplianceConfig | null {
  const cached = complianceCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }
  if (cached) {
    complianceCache.delete(key);
  }
  return null;
}

function setCachedCompliance(key: string, data: ComplianceConfig): void {
  complianceCache.set(key, { data, timestamp: Date.now() });
}

function getCachedIdentifiers(key: string): CountryIdentifierConfig | null {
  const cached = identifierCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }
  if (cached) {
    identifierCache.delete(key);
  }
  return null;
}

function setCachedIdentifiers(key: string, data: CountryIdentifierConfig): void {
  identifierCache.set(key, { data, timestamp: Date.now() });
}

/**
 * Hook to fetch and use compliance configuration
 * Uses in-memory cache with 5h TTL to avoid redundant API calls
 */
export function useCompliance(params: UseComplianceParams): UseComplianceReturn {
  const { supplierCountry, customerCountry, transactionType = 'B2B', nature = 'services' } = params;

  // Build cache key
  const cacheKey = useMemo(
    () => `${supplierCountry}|${customerCountry || ''}|${transactionType}|${nature}`,
    [supplierCountry, customerCountry, transactionType, nature],
  );

  // State for cached/fetched data
  const [config, setConfig] = useState<ComplianceConfig | null>(() => getCachedCompliance(cacheKey));
  const [isLoading, setIsLoading] = useState(!config);
  const [error, setError] = useState<Error | null>(null);

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
    return `/api/compliance/config?${searchParams.toString()}`;
  }, [supplierCountry, customerCountry, transactionType, nature]);

  // Fetch data (only if not cached)
  useEffect(() => {
    const cached = getCachedCompliance(cacheKey);
    if (cached) {
      setConfig(cached);
      setIsLoading(false);
      setError(null);
      return;
    }

    setIsLoading(true);
    const fullUrl = `${import.meta.env.VITE_BACKEND_URL || ''}${url}`;

    authenticatedFetch(fullUrl)
      .then(async (res) => {
        if (!res.ok) throw new Error(`GET ${url} failed with status ${res.status}`);
        const data = (await res.json()) as ComplianceConfig;
        setCachedCompliance(cacheKey, data);
        setConfig(data);
        setError(null);
      })
      .catch((err) => {
        setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [cacheKey, url]);

  // Refetch function (bypasses cache)
  const refetch = useCallback(() => {
    complianceCache.delete(cacheKey);
    setIsLoading(true);
    const fullUrl = `${import.meta.env.VITE_BACKEND_URL || ''}${url}`;

    authenticatedFetch(fullUrl)
      .then(async (res) => {
        if (!res.ok) throw new Error(`GET ${url} failed with status ${res.status}`);
        const data = (await res.json()) as ComplianceConfig;
        setCachedCompliance(cacheKey, data);
        setConfig(data);
        setError(null);
      })
      .catch((err) => {
        setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [cacheKey, url]);

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
 * Custom field config from API
 */
export interface CustomFieldConfig {
  id: string;
  labelKey: string;
  type: 'string' | 'number' | 'date' | 'select' | 'boolean';
  required: boolean;
  format: string | null;
  options: Array<{ value: string; labelKey: string }> | null;
}

/**
 * Country identifier config response
 */
export interface CountryIdentifierConfig {
  identifiers: IdentifierFieldConfig[];
  vat: VATFieldConfig;
  customFields: CustomFieldConfig[];
}

/**
 * Hook to fetch identifier config for a country (for onboarding/client creation)
 * Uses in-memory cache with 5h TTL to avoid redundant API calls
 * @param country - Country code (e.g., FR, DE)
 * @param entityType - Entity type: 'company' (default) or 'client'
 * Returns empty identifiers array for unsupported countries
 */
export function useCountryIdentifiers(
  country: string | undefined,
  entityType: 'company' | 'client' = 'company',
) {
  // Build cache key
  const cacheKey = useMemo(
    () => (country ? `${country}|${entityType}` : null),
    [country, entityType],
  );

  // State for cached/fetched data
  const [data, setData] = useState<CountryIdentifierConfig | null>(() =>
    cacheKey ? getCachedIdentifiers(cacheKey) : null,
  );
  const [isLoading, setIsLoading] = useState(!data && !!country);
  const [error, setError] = useState<Error | null>(null);

  const url = useMemo(
    () =>
      country ? `/api/compliance/identifiers?country=${country}&entityType=${entityType}` : null,
    [country, entityType],
  );

  // Fetch data (only if not cached)
  useEffect(() => {
    if (!url || !cacheKey) {
      setData(null);
      setIsLoading(false);
      return;
    }

    const cached = getCachedIdentifiers(cacheKey);
    if (cached) {
      setData(cached);
      setIsLoading(false);
      setError(null);
      return;
    }

    setIsLoading(true);
    const fullUrl = `${import.meta.env.VITE_BACKEND_URL || ''}${url}`;

    authenticatedFetch(fullUrl)
      .then(async (res) => {
        if (!res.ok) throw new Error(`GET ${url} failed with status ${res.status}`);
        const result = (await res.json()) as CountryIdentifierConfig;
        setCachedIdentifiers(cacheKey, result);
        setData(result);
        setError(null);
      })
      .catch((err) => {
        setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [cacheKey, url]);

  // Refetch function (bypasses cache)
  const refetch = useCallback(() => {
    if (!cacheKey || !url) return;

    identifierCache.delete(cacheKey);
    setIsLoading(true);
    const fullUrl = `${import.meta.env.VITE_BACKEND_URL || ''}${url}`;

    authenticatedFetch(fullUrl)
      .then(async (res) => {
        if (!res.ok) throw new Error(`GET ${url} failed with status ${res.status}`);
        const result = (await res.json()) as CountryIdentifierConfig;
        setCachedIdentifiers(cacheKey, result);
        setData(result);
        setError(null);
      })
      .catch((err) => {
        setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [cacheKey, url]);

  return {
    identifiers: data?.identifiers || [],
    vat: data?.vat || { labelKey: null, format: null, example: null },
    customFields: data?.customFields || [],
    isLoading,
    error,
    refetch,
  };
}
