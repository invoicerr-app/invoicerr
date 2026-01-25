/** User roles in the system (global) */
export type UserRole = 'USER' | 'SYSTEM_ADMIN';

/** Role within a specific company */
export type CompanyRole = 'OWNER' | 'ADMIN' | 'ACCOUNTANT';

/** User's membership in a company */
export interface UserCompany {
  id: string;
  companyId: string;
  companyName: string;
  role: CompanyRole;
  joinedAt: Date | string;
}

/** Invitation to join a company */
export interface CompanyInvitation {
  id: string;
  code: string;
  companyId: string | null;
  companyName?: string;
  role: CompanyRole;
  expiresAt: Date | string | null;
  createdAt: Date | string;
  invitedBy?: {
    id: string;
    firstname: string;
    lastname: string;
  };
}

/** Extended user info with role */
export interface UserWithRole {
  id: string;
  email: string;
  firstname: string;
  lastname: string;
  role: UserRole;
  createdAt: Date | string;
}

/** Company with the user's role in it */
export interface CompanyWithRole {
  id: string;
  name: string;
  country: string;
  currency: string;
  role: CompanyRole;
  joinedAt: Date | string;
}

/** Admin view of a user with their companies */
export interface AdminUser {
  id: string;
  email: string;
  firstname: string;
  lastname: string;
  isSystemAdmin: boolean;
  createdAt: Date | string;
  companies: Array<{
    companyId: string;
    companyName: string;
    role: CompanyRole;
    joinedAt: Date | string;
    isDefault: boolean;
  }>;
}

/** Admin view of a company with its users */
export interface AdminCompany {
  id: string;
  name: string;
  country: string;
  currency: string;
  createdAt: Date | string;
  users: Array<{
    userId: string;
    email: string;
    firstname: string;
    lastname: string;
    role: CompanyRole;
    joinedAt: Date | string;
  }>;
}

/** System-wide statistics for admin dashboard */
export interface SystemStats {
  totalUsers: number;
  totalCompanies: number;
  totalInvoices: number;
  totalQuotes: number;
  totalClients: number;
  systemAdminCount: number;
}
