import { ExecutionContext, createParamDecorator } from '@nestjs/common';

import { CompanyRole } from '../../prisma/generated/prisma/client';
import { RequestWithUser } from '@/types/request';

// Same pattern as ActiveCompany (active-company.decorator.ts), but never throws: `request.role` is
// already nullable for a session with no memberships yet (RequestWithUser's own comment), and — unlike
// the active company — a missing role is a legitimate caller a gate is allowed to just let through
// (an API key with no role attached; see documents/approval/approval-gate.ts's own header on why
// `undefined` there means "not a MEMBER, proceed" rather than "reject"). Callers that DO require a
// role use `@Roles()`/`RolesGuard` instead, which already 403s before a handler using this ever runs.
export const ActiveRole = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): CompanyRole | undefined => {
    const request = ctx.switchToHttp().getRequest() as RequestWithUser;
    return request.role ?? undefined;
  },
);
