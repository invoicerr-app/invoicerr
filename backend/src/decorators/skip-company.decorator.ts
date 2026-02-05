import { SetMetadata } from '@nestjs/common';
import { SKIP_COMPANY_GUARD_KEY } from '@/guards/company.guard';

/**
 * Decorator to skip the CompanyGuard on a route or controller.
 * Use this for routes that don't require company context.
 *
 * @example
 * ```typescript
 * @SkipCompanyGuard()
 * @Get('profile')
 * getProfile() { ... }
 * ```
 */
export const SkipCompanyGuard = () => SetMetadata(SKIP_COMPANY_GUARD_KEY, true);
