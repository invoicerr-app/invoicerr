import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { authenticatedFetch } from '@/hooks/use-fetch';
import type { Company, UserCompany } from '@/types';

const STORAGE_KEY = 'invoicerr_active_company_id';

interface CompanyContextValue {
  /** List of companies the user belongs to */
  companies: UserCompany[];
  /** Currently active company ID */
  activeCompanyId: string | null;
  /** Currently active company details */
  activeCompany: Company | null;
  /** Whether companies are loading */
  isLoading: boolean;
  /** Switch to a different company */
  switchCompany: (companyId: string) => void;
  /** Refresh the companies list */
  refreshCompanies: () => Promise<void>;
}

const CompanyContext = createContext<CompanyContextValue | null>(null);

interface CompanyProviderProps {
  children: ReactNode;
}

export function CompanyProvider({ children }: CompanyProviderProps) {
  const [companies, setCompanies] = useState<UserCompany[]>([]);
  const [activeCompanyId, setActiveCompanyId] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(STORAGE_KEY);
    }
    return null;
  });
  const [activeCompany, setActiveCompany] = useState<Company | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const backendUrl = import.meta.env.VITE_BACKEND_URL || '';

  const fetchCompanies = useCallback(async () => {
    try {
      const response = await authenticatedFetch(`${backendUrl}/api/company/user-companies`);
      if (response.ok) {
        const data = await response.json();
        setCompanies(data);
      }
    } catch (error) {
      console.error('Failed to fetch companies:', error);
    } finally {
      setIsLoading(false);
    }
  }, [backendUrl]);

  const fetchActiveCompany = useCallback(async (companyId: string) => {
    try {
      const response = await authenticatedFetch(`${backendUrl}/api/company/info`, {
        headers: {
          'X-Company-Id': companyId,
        },
      });
      if (response.ok) {
        const data = await response.json();
        setActiveCompany(data);
      }
    } catch (error) {
      console.error('Failed to fetch active company:', error);
    }
  }, [backendUrl]);

  const switchCompany = useCallback(async (companyId: string) => {
    setActiveCompanyId(companyId);
    localStorage.setItem(STORAGE_KEY, companyId);
    // Update default company on backend
    try {
      await authenticatedFetch(`${backendUrl}/api/company/set-default`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId }),
      });
    } catch (error) {
      console.error('Failed to set default company:', error);
    }
  }, [backendUrl]);

  const refreshCompanies = useCallback(async () => {
    setIsLoading(true);
    await fetchCompanies();
  }, [fetchCompanies]);

  // Fetch companies on mount
  useEffect(() => {
    fetchCompanies();
  }, [fetchCompanies]);

  // Fetch active company details when activeCompanyId changes
  useEffect(() => {
    if (activeCompanyId) {
      fetchActiveCompany(activeCompanyId);
    } else {
      setActiveCompany(null);
    }
  }, [activeCompanyId, fetchActiveCompany]);

  // Auto-select first company if none is selected
  useEffect(() => {
    if (!activeCompanyId && companies.length > 0) {
      switchCompany(companies[0].companyId);
    }
  }, [activeCompanyId, companies, switchCompany]);

  const value = useMemo<CompanyContextValue>(
    () => ({
      companies,
      activeCompanyId,
      activeCompany,
      isLoading,
      switchCompany,
      refreshCompanies,
    }),
    [companies, activeCompanyId, activeCompany, isLoading, switchCompany, refreshCompanies],
  );

  return <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>;
}

export function useCompany(): CompanyContextValue {
  const context = useContext(CompanyContext);
  if (!context) {
    throw new Error('useCompany must be used within a CompanyProvider');
  }
  return context;
}

/** Hook to get the active company ID for API calls */
export function useActiveCompanyId(): string | null {
  const { activeCompanyId } = useCompany();
  return activeCompanyId;
}
