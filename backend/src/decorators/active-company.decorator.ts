import { ExecutionContext, ForbiddenException, createParamDecorator } from '@nestjs/common';

import { RequestWithUser } from '@/types/request';

export const ActiveCompany = createParamDecorator((data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest() as RequestWithUser;
  if (!request.companyId) {
    throw new ForbiddenException('No active company selected');
  }
  return request.companyId;
});
