import { CurrentUser } from '@/types/user';
import { Request } from 'express';

interface RequestWithUser extends Request {
    user: CurrentUser
}

export { RequestWithUser };