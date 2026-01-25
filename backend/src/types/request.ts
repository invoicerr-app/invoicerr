import type { Request } from 'express';
import type { CurrentUser } from '@/types/user';
import type { CompanyContext } from '@/types/company-context';

interface RequestWithUser extends Request {
  user: CurrentUser;
  companyContext?: CompanyContext;
}

export type { RequestWithUser };
