import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { RequestWithUser } from '@/types/request';
import type { CompanyContext } from '@/types/company-context';

/**
 * Decorator to extract the company ID from the request.
 * Requires CompanyGuard to be applied first.
 *
 * @example
 * ```typescript
 * @Get('invoices')
 * getInvoices(@CompanyId() companyId: string) { ... }
 * ```
 */
export const CompanyId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest() as RequestWithUser;
    return request.companyContext?.companyId;
  },
);

/**
 * Decorator to extract the full company context from the request.
 * Requires CompanyGuard to be applied first.
 *
 * @example
 * ```typescript
 * @Get('invoices')
 * getInvoices(@CurrentCompany() company: CompanyContext) { ... }
 * ```
 */
export const CurrentCompany = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CompanyContext | undefined => {
    const request = ctx.switchToHttp().getRequest() as RequestWithUser;
    return request.companyContext;
  },
);
