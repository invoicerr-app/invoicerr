import type { UserCompanyRole, Company, UserCompany } from '../../prisma/generated/prisma/client';

/**
 * Company context attached to the request after CompanyGuard validation
 */
export interface CompanyContext {
  companyId: string;
  company: Company;
  userCompany: UserCompany;
  role: UserCompanyRole;
}

/**
 * Extended current user with multi-tenant information
 */
export interface CurrentUserWithCompanies {
  id: string;
  firstname: string;
  lastname: string;
  email: string;
  isSystemAdmin: boolean;
  companies: UserCompany[];
}
