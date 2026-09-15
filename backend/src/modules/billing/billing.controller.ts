/**
 * `GET /api/billing/status` — the ONLY route this feature adds to Nest's own controller layer (every
 * other billing-facing route — checkout, portal, webhooks — is better-auth's own middleware, see
 * `polar-plugin.ts`'s header). This controller is registered ONLY when `BillingModule` itself is
 * imported (`app.module.ts`, behind the flag) — so with the flag absent, this route does not exist at
 * all and Nest's own catch-all answers 404, exactly the "routes absentes ou 404" guarantee the
 * product brief asks for; there is no explicit flag check to write or test HERE, only the import
 * itself (proven by `72-billing-hidden.cy.ts` and `billing.controller.spec.ts`'s own "not registered
 * at all" style assertion via `app.module.ts`).
 */
import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { ActiveCompany } from '@/decorators/active-company.decorator';

import { BillingStatusView, computeBillingStatusView } from './billing-status-view';
import { getOrCreateCompanySubscription } from './company-subscription.store';

@ApiTags('billing')
@Controller('billing')
export class BillingController {
  @Get('status')
  @ApiOperation({
    summary: "This company's hosted-billing status",
    description:
      'Status, days remaining until the next lifecycle boundary, seat count, and the checkout/' +
      'portal route paths. Lazily creates a fresh TRIAL subscription row on first call for a ' +
      'company that has never been touched yet (see company-subscription.store.ts).',
  })
  @ApiResponse({ status: 200, description: 'Billing status computed' })
  async getStatus(@ActiveCompany() companyId: string): Promise<BillingStatusView> {
    const sub = await getOrCreateCompanySubscription(companyId);
    return computeBillingStatusView(sub);
  }
}
