import { RequestWithUser } from '@/types/request';
import { CurrentUser } from '@/types/user';
import { ExecutionContext, createParamDecorator } from '@nestjs/common';

export const User = createParamDecorator((_data: unknown, ctx: ExecutionContext): CurrentUser => {
  const request = ctx.switchToHttp().getRequest() as RequestWithUser;
  return request.user;
});
