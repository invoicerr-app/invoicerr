import type { User, UserCompany } from '../../prisma/generated/prisma/client';

export interface CurrentUser extends Omit<User, 'password'> {
  id: string;
  firstname: string;
  lastname: string;
  email: string;
  isSystemAdmin: boolean;
  accessToken: string;
  companies?: UserCompany[];
}
