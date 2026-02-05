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
  /** Whether companies are loading (true until both companies list AND active company are loaded) */
  isLoading: boolean;
  /** Switch to a different company */
  switchCompany: (companyId: string) => void;
  /** Refresh the companies list */
  refreshCompanies: () => Promise<void>;
  /** Set active company directly (used after creation to avoid refetch race) */
  setActiveCompanyDirect: (company: Company) => void;
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
  const [isCompaniesLoading, setIsCompaniesLoading] = useState(true);
  const [isActiveCompanyLoading, setIsActiveCompanyLoading] = useState(true);

  const backendUrl = import.meta.env.VITE_BACKEND_URL || '';

  const fetchCompanies = useCallback(async () => {
    try {
      const response = await authenticatedFetch(`${backendUrl}/api/company/user-companies`);
      if (response.ok) {
        const data = await response.json();
        setCompanies(data);
        // If no companies exist, we're done loading
        if (data.length === 0) {
          setIsActiveCompanyLoading(false);
        }
      } else {
        // If fetch fails, still mark as done loading
        setIsActiveCompanyLoading(false);
      }
    } catch (error) {
      console.error('Failed to fetch companies:', error);
      setIsActiveCompanyLoading(false);
    } finally {
      setIsCompaniesLoading(false);
    }
  }, [backendUrl]);

  const fetchActiveCompany = useCallback(async (companyId: string) => {
    setIsActiveCompanyLoading(true);
    try {
      const response = await authenticatedFetch(`${backendUrl}/api/company/info`, {
        headers: {
          'X-Company-Id': companyId,
        },
      });
      if (response.ok) {
        const data = await response.json();
        // Check if we got actual company data (not empty object)
        if (data && data.id && data.name) {
          setActiveCompany(data);
        } else {
          // Empty response means company not found or no access
          console.warn('Company info returned empty, clearing activeCompany');
          setActiveCompany(null);
          // Clear invalid companyId from localStorage
          localStorage.removeItem(STORAGE_KEY);
          setActiveCompanyId(null);
        }
      } else {
        console.error('Failed to fetch company info:', response.status);
        setActiveCompany(null);
        // Clear invalid companyId on error
        localStorage.removeItem(STORAGE_KEY);
        setActiveCompanyId(null);
      }
    } catch (error) {
      console.error('Failed to fetch active company:', error);
      setActiveCompany(null);
      // Clear invalid companyId on error
      localStorage.removeItem(STORAGE_KEY);
      setActiveCompanyId(null);
    } finally {
      setIsActiveCompanyLoading(false);
    }
  }, [backendUrl]);

  const switchCompany = useCallback(async (companyId: string) => {
    // Don't switch if already on this company
    if (companyId === activeCompanyId) return;

    localStorage.setItem(STORAGE_KEY, companyId);
    // Update default company on backend
    try {
      await authenticatedFetch(`${backendUrl}/api/company/set-default`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId }),
      });
      // Reload the page to refresh all data with new company context
      window.location.reload();
    } catch (error) {
      console.error('Failed to set default company:', error);
    }
  }, [backendUrl, activeCompanyId]);

  const refreshCompanies = useCallback(async () => {
    setIsCompaniesLoading(true);
    await fetchCompanies();
  }, [fetchCompanies]);

  const setActiveCompanyDirect = useCallback((company: Company) => {
    setActiveCompanyId(company.id);
    setActiveCompany(company);
    setIsActiveCompanyLoading(false);
    localStorage.setItem(STORAGE_KEY, company.id);
  }, []);

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
      // Only mark as not loading if companies are also done loading
      if (!isCompaniesLoading) {
        setIsActiveCompanyLoading(false);
      }
    }
  }, [activeCompanyId, fetchActiveCompany, isCompaniesLoading]);

  // Auto-select first company if none is selected
  useEffect(() => {
    if (!activeCompanyId && companies.length > 0) {
      switchCompany(companies[0].companyId);
    }
  }, [activeCompanyId, companies, switchCompany]);

  // Combined loading state: true until both companies list AND active company are loaded
  const isLoading = isCompaniesLoading || isActiveCompanyLoading;

  const value = useMemo<CompanyContextValue>(
    () => ({
      companies,
      activeCompanyId,
      activeCompany,
      isLoading,
      switchCompany,
      refreshCompanies,
      setActiveCompanyDirect,
    }),
    [companies, activeCompanyId, activeCompany, isLoading, switchCompany, refreshCompanies, setActiveCompanyDirect],
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
