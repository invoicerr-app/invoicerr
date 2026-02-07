import { useState, useCallback } from 'react';
import { useGet, usePost, authenticatedFetch } from './use-fetch';
import { UserCompany, UserRole } from '@/contexts/company-context';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';

interface UseUserCompaniesReturn {
  companies: UserCompany[];
  isLoading: boolean;
  error: Error | null;
  refresh: () => void;
}

export function useUserCompanies(): UseUserCompaniesReturn {
  const { data, loading, error, mutate } = useGet<UserCompany[]>('/api/company/my-companies');

  return {
    companies: data || [],
    isLoading: loading,
    error,
    refresh: mutate,
  };
}

interface JoinCompanyResult {
  success: boolean;
  company?: UserCompany;
  error?: string;
}

interface UseJoinCompanyReturn {
  joinCompany: (invitationCode: string) => Promise<JoinCompanyResult>;
  isLoading: boolean;
  error: Error | null;
}

export function useJoinCompany(): UseJoinCompanyReturn {
  const { t } = useTranslation();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const joinCompany = useCallback(async (invitationCode: string): Promise<JoinCompanyResult> => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await authenticatedFetch('/api/invitations/join', {
        method: 'POST',
        body: JSON.stringify({ code: invitationCode }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Failed to join company');
      }

      toast.success(t('company.join.success'));
      return { success: true, company: data };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to join company';
      setError(err instanceof Error ? err : new Error(errorMessage));
      toast.error(errorMessage);
      return { success: false, error: errorMessage };
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  return {
    joinCompany,
    isLoading,
    error,
  };
}

interface CompanyMember {
  id: string;
  userId: string;
  email: string;
  firstname: string;
  lastname: string;
  role: UserRole;
  joinedAt: string;
}

interface UseCompanyMembersReturn {
  members: CompanyMember[];
  isLoading: boolean;
  error: Error | null;
  refresh: () => void;
  updateMemberRole: (memberId: string, newRole: UserRole) => Promise<boolean>;
  removeMember: (memberId: string) => Promise<boolean>;
}

export function useCompanyMembers(companyId?: string): UseCompanyMembersReturn {
  const { t } = useTranslation();
  const url = companyId ? `/api/companies/${companyId}/members` : '/api/company/members';
  const { data, loading, error, mutate } = useGet<CompanyMember[]>(url);

  const updateMemberRole = useCallback(async (memberId: string, newRole: UserRole): Promise<boolean> => {
    try {
      const response = await authenticatedFetch(`/api/company/members/${memberId}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role: newRole }),
      });

      if (!response.ok) {
        throw new Error('Failed to update member role');
      }

      toast.success(t('company.members.roleUpdated'));
      mutate();
      return true;
    } catch (err) {
      toast.error(t('company.members.roleUpdateError'));
      return false;
    }
  }, [t, mutate]);

  const removeMember = useCallback(async (memberId: string): Promise<boolean> => {
    try {
      const response = await authenticatedFetch(`/api/company/members/${memberId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to remove member');
      }

      toast.success(t('company.members.removed'));
      mutate();
      return true;
    } catch (err) {
      toast.error(t('company.members.removeError'));
      return false;
    }
  }, [t, mutate]);

  return {
    members: data || [],
    isLoading: loading,
    error,
    refresh: mutate,
    updateMemberRole,
    removeMember,
  };
}

interface Invitation {
  id: string;
  code: string;
  companyId: string;
  companyName: string;
  role: UserRole;
  expiresAt: string | null;
  createdAt: string;
  usedBy: string | null;
  usedAt: string | null;
}

interface CreateInvitationData {
  role?: UserRole;
  expiresInDays?: number | null;
}

interface UseInvitationsReturn {
  invitations: Invitation[];
  isLoading: boolean;
  error: Error | null;
  refresh: () => void;
  createInvitation: (data: CreateInvitationData) => Promise<Invitation | null>;
  deleteInvitation: (invitationId: string) => Promise<boolean>;
}

export function useInvitations(): UseInvitationsReturn {
  const { t } = useTranslation();
  const { data, loading, error, mutate } = useGet<Invitation[]>('/api/company/invitations');
  const { trigger: createTrigger } = usePost<Invitation>('/api/company/invitations');

  const createInvitation = useCallback(async (invitationData: CreateInvitationData): Promise<Invitation | null> => {
    try {
      const result = await createTrigger(invitationData);
      if (result) {
        toast.success(t('company.invite.codeGenerated'));
        mutate();
      }
      return result;
    } catch (err) {
      toast.error(t('company.invite.createError'));
      return null;
    }
  }, [createTrigger, mutate, t]);

  const deleteInvitation = useCallback(async (invitationId: string): Promise<boolean> => {
    try {
      const response = await authenticatedFetch(`/api/company/invitations/${invitationId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete invitation');
      }

      toast.success(t('company.invite.deleted'));
      mutate();
      return true;
    } catch (err) {
      toast.error(t('company.invite.deleteError'));
      return false;
    }
  }, [mutate, t]);

  return {
    invitations: data || [],
    isLoading: loading,
    error,
    refresh: mutate,
    createInvitation,
    deleteInvitation,
  };
}
