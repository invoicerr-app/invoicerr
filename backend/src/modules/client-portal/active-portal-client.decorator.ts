import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';

import { PortalIdentity } from './portal-auth.guard';

/**
 * The portal's own `@ActiveCompany()` — except it hands back BOTH halves of the boundary at once
 * (`companyId` AND `clientId`), never one alone: every `PortalService` method takes both and scopes by
 * both (see that file's own header), so there is no call shape that could accidentally scope by
 * company only. Throwing here (rather than trusting `PortalAuthGuard` always ran first) is the same
 * defense-in-depth `ActiveCompany` itself already holds for `request.companyId` — a guard ordering bug
 * degrades to a 401, never to an unscoped read.
 */
export const ActivePortalClient = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): PortalIdentity => {
    const request = ctx.switchToHttp().getRequest<Request & { portal?: PortalIdentity }>();
    if (!request.portal) {
      throw new UnauthorizedException('No active portal session.');
    }
    return request.portal;
  },
);
