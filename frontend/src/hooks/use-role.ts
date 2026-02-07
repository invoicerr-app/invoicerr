import { useCompany, useCurrentRole, useIsAdmin, useIsSuperAdmin, UserRole } from '@/contexts/company-context';

export { useCompany, useCurrentRole, useIsAdmin, useIsSuperAdmin };
export type { UserRole };

// Extended role hooks with permission checks
export function useRole() {
  const { currentRole, isSuperAdmin } = useCompany();

  return {
    role: currentRole,
    isSuperAdmin,
    isAdmin: currentRole === 'ADMIN' || currentRole === 'SUPERADMIN',
    isUser: currentRole === 'USER',
    
    // Permission helpers
    canInvite: () => currentRole === 'ADMIN' || currentRole === 'SUPERADMIN',
    canManageSettings: () => currentRole === 'ADMIN' || currentRole === 'SUPERADMIN',
    canDeleteCompany: () => currentRole === 'ADMIN' || currentRole === 'SUPERADMIN',
    canManageMembers: () => currentRole === 'ADMIN' || currentRole === 'SUPERADMIN',
    canViewAdminDashboard: () => isSuperAdmin,
    canManageAllCompanies: () => isSuperAdmin,
    
    // Role checks
    hasRole: (roles: UserRole[]) => {
      if (!currentRole) return false;
      return roles.includes(currentRole);
    },
    hasMinimumRole: (minimumRole: UserRole) => {
      if (!currentRole) return false;
      const roleHierarchy: Record<UserRole, number> = {
        'USER': 1,
        'ADMIN': 2,
        'SUPERADMIN': 3,
      };
      return roleHierarchy[currentRole] >= roleHierarchy[minimumRole];
    },
  };
}
