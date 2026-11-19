/**
 * `GET /api/billing/status` - the one hosted-billing route on Nest's own controller layer. Checkout,
 * the customer portal and the Stripe webhook all live under `/api/auth/*`, served by the Better Auth
 * Stripe plugin (`stripe-plugin.ts`). This controller is registered ONLY when `BillingModule` itself is
 * imported (`app.module.ts`, behind the flag) - so with the flag absent, the route does not exist at
 * all and Nest's own catch-all answers 404.
 */
import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { ActiveCompany } from '@/decorators/active-company.decorator';
import { RequiresScope } from '@/utils/scope-check';

import { BillingStatusView, computeBillingStatusView } from './billing-status-view';
import { getOrCreateCompanySubscription } from './company-subscription.store';

@ApiTags('billing')
@Controller('billing')
export class BillingController {
  @Get('status')
  @RequiresScope('billing:read')
  @ApiOperation({
    summary: "This company's hosted-billing status",
    description:
      'Status, days remaining until the next lifecycle boundary, seat count and billing interval. ' +
      'Lazily creates a fresh TRIAL subscription row on first call for a company that has never been ' +
      'touched yet (see company-subscription.store.ts).',
  })
  @ApiResponse({ status: 200, description: 'Billing status computed' })
  async getStatus(@ActiveCompany() companyId: string): Promise<BillingStatusView> {
    return computeBillingStatusView(await getOrCreateCompanySubscription(companyId));
  }
}
