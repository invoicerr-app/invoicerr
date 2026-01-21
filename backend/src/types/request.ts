import type { Request } from 'express';
import type { CurrentUser } from '@/types/user';

interface RequestWithUser extends Request {
  user: CurrentUser;
}

export type { RequestWithUser };
