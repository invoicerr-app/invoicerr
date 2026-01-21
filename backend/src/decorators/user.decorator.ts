import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { RequestWithUser } from '@/types/request';
import type { CurrentUser } from '@/types/user';

export const User = createParamDecorator((_data: unknown, ctx: ExecutionContext): CurrentUser => {
  const request = ctx.switchToHttp().getRequest() as RequestWithUser;
  return request.user;
});
