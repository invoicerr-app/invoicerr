import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { Company } from '@/types';
import { useGet, usePost } from '@/hooks/use-fetch';
import { toast } from 'sonner';

export type UserRole = 'SUPERADMIN' | 'ADMIN' | 'USER';

export interface UserCompany {
  companyId: string;
  company: Company;
  role: UserRole;
}

interface CompanyContextType {
  currentCompany: Company | null;
  userCompanies: UserCompany[];
  isSuperAdmin: boolean;
  currentRole: UserRole | null;
  isLoading: boolean;
  switchCompany: (companyId: string) => Promise<void>;
  refreshCompanies: () => Promise<void>;
  createCompany: (name: string) => Promise<Company | null>;
  currentCompanyId: string | null;
}

const CompanyContext = createContext<CompanyContextType | undefined>(undefined);

export function CompanyProvider({ children }: { children: React.ReactNode }) {
  // Initialize companyId from localStorage first (synchronous)
  const [initialCompanyId] = useState(() => localStorage.getItem('companyId'));
  const [currentCompanyId, setCurrentCompanyId] = useState<string | null>(initialCompanyId);

  // Fetch user's companies
  const { 
    data: userCompaniesData, 
    loading: companiesLoading, 
    mutate: refreshCompaniesList 
  } = useGet<UserCompany[]>('/api/company/my-companies');

  const userCompanies = userCompaniesData || [];

  // Auto-select company if localStorage ID is not in user's companies
  useEffect(() => {
    if (userCompanies.length > 0 && currentCompanyId) {
      const isValidCompany = userCompanies.some(uc => uc.companyId === currentCompanyId);
      if (!isValidCompany) {
        setCurrentCompanyId(userCompanies[0].companyId);
      }
    }
  }, [userCompanies, currentCompanyId]);

  // Fetch current company details using X-Company-Id header
  const { 
    data: currentCompanyData, 
    loading: companyLoading 
  } = useGet<Company>('/api/company/info');

  const currentCompany = currentCompanyData || null;
  
  // Determine current role based on current company
  const currentRole = currentCompanyId 
    ? userCompanies.find(uc => uc.companyId === currentCompanyId)?.role || null
    : userCompanies.find(uc => uc.company.id === currentCompany?.id)?.role || null;
  
  const isSuperAdmin = userCompanies.some(uc => uc.role === 'SUPERADMIN');
  const isLoading = companiesLoading || companyLoading;

  // Initialize companyId from first company on mount
  useEffect(() => {
    if (!currentCompanyId && userCompanies.length > 0) {
      setCurrentCompanyId(userCompanies[0].companyId);
    }
  }, [userCompanies, currentCompanyId]);

  const { trigger: switchTrigger } = usePost('/api/company/switch');
  const { trigger: createTrigger } = usePost<Company>('/api/company');

  const switchCompany = useCallback(async (companyId: string) => {
    try {
      const result = await switchTrigger({ companyId });
      if (result) {
        localStorage.setItem('companyId', companyId);
        window.location.reload();
      }
    } catch (error) {
      console.error('Error switching company:', error);
      toast.error('Failed to switch company');
    }
  }, [switchTrigger]);

  const refreshCompanies = useCallback(async () => {
    await refreshCompaniesList();
  }, [refreshCompaniesList]);

  const createCompany = useCallback(async (name: string): Promise<Company | null> => {
    try {
      const newCompany = await createTrigger({ name });
      if (newCompany) {
        await refreshCompaniesList();
        toast.success('Company created successfully');
        return newCompany;
      }
      return null;
    } catch (error) {
      console.error('Error creating company:', error);
      toast.error('Failed to create company');
      return null;
    }
  }, [createTrigger, refreshCompaniesList]);

  return (
    <CompanyContext.Provider
      value={{
        currentCompany,
        userCompanies,
        isSuperAdmin,
        currentRole,
        isLoading,
        switchCompany,
        refreshCompanies,
        createCompany,
        currentCompanyId,
      }}
    >
      {children}
    </CompanyContext.Provider>
  );
}

export function useCompany() {
  const context = useContext(CompanyContext);
  if (context === undefined) {
    throw new Error('useCompany must be used within a CompanyProvider');
  }
  return context;
}

export function useCurrentRole(): UserRole | null {
  const { currentRole } = useCompany();
  return currentRole;
}

export function useIsAdmin(): boolean {
  const { currentRole } = useCompany();
  return currentRole === 'ADMIN' || currentRole === 'SUPERADMIN';
}

export function useIsSuperAdmin(): boolean {
  const { isSuperAdmin } = useCompany();
  return isSuperAdmin;
}

export function useCurrentCompanyId(): string | null {
  const { currentCompanyId } = useCompany();
  return currentCompanyId;
}
