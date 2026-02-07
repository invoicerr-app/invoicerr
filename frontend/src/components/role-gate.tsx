import React from 'react';
import { useRole, UserRole } from '@/hooks/use-role';
import { useTranslation } from 'react-i18next';

interface RoleGateProps {
  allowedRoles: UserRole[];
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export function RoleGate({ allowedRoles, children, fallback = null }: RoleGateProps) {
  const { hasRole } = useRole();
  const hasAccess = hasRole(allowedRoles);

  if (!hasAccess) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}

interface RoleBasedProps {
  minimumRole?: UserRole;
  exactRole?: UserRole;
  allowedRoles?: UserRole[];
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export function RoleBased({
  minimumRole,
  exactRole,
  allowedRoles,
  children,
  fallback = null,
}: RoleBasedProps) {
  const { role, hasMinimumRole, hasRole } = useRole();
  const { t } = useTranslation();

  let hasAccess = false;

  if (exactRole) {
    hasAccess = role === exactRole;
  } else if (minimumRole) {
    hasAccess = hasMinimumRole(minimumRole);
  } else if (allowedRoles) {
    hasAccess = hasRole(allowedRoles);
  }

  if (!hasAccess) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}

// Admin-only content wrapper
interface AdminOnlyProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export function AdminOnly({ children, fallback = null }: AdminOnlyProps) {
  return (
    <RoleGate allowedRoles={['ADMIN', 'SUPERADMIN']} fallback={fallback}>
      {children}
    </RoleGate>
  );
}

// SuperAdmin-only content wrapper
interface SuperAdminOnlyProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export function SuperAdminOnly({ children, fallback = null }: SuperAdminOnlyProps) {
  return (
    <RoleGate allowedRoles={['SUPERADMIN']} fallback={fallback}>
      {children}
    </RoleGate>
  );
}

// Hook-based role check for conditional rendering inline
export function useRoleGate() {
  const { hasRole, hasMinimumRole, isAdmin, isSuperAdmin } = useRole();

  return {
    isAdmin,
    isSuperAdmin,
    canAccess: (roles: UserRole[]) => hasRole(roles),
    hasMinimumRole,
    // Permission-specific checks
    canInvite: isAdmin,
    canManageSettings: isAdmin,
    canDeleteCompany: isAdmin,
    canManageMembers: isAdmin,
    canViewAdminDashboard: isSuperAdmin,
  };
}
