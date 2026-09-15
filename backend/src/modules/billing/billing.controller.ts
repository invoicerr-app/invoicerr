/**
 * `GET /api/billing/status` and `POST /api/billing/portal` — the two routes this feature adds to
 * Nest's own controller layer. Checkout and webhooks are still better-auth's own middleware (see
 * `polar-plugin.ts`'s header); `portal` moved HERE (off better-auth's own `/api/auth/customer/portal`
 * route) specifically because that route cannot supply `memberId`, which Polar requires for this
 * product's TEAM customers — see `portal-session.ts`'s own header for the full chain. This controller
 * is registered ONLY when `BillingModule` itself is imported (`app.module.ts`, behind the flag) — so
 * with the flag absent, neither route exists at all and Nest's own catch-all answers 404, exactly the
 * "routes absentes ou 404" guarantee the product brief asks for; there is no explicit flag check to
 * write or test HERE, only the import itself (proven by `72-billing-hidden.cy.ts` and
 * `billing.controller.spec.ts`'s own "not registered at all" style assertion via `app.module.ts`).
 */
import { Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { ActiveCompany } from '@/decorators/active-company.decorator';
import { User } from '@/decorators/user.decorator';
import { CurrentUser } from '@/types/user';

import { BillingStatusView, computeBillingStatusView } from './billing-status-view';
import { getOrCreateCompanySubscription } from './company-subscription.store';
import { FALLBACK_RETURN_URL } from './portal-return-url';
import { createCustomerPortalSession, PortalSessionResult } from './portal-session';
import { reconcileFromPolarIfStale } from './status-reconcile';

@ApiTags('billing')
@Controller('billing')
export class BillingController {
  @Get('status')
  @ApiOperation({
    summary: "This company's hosted-billing status",
    description:
      'Status, days remaining until the next lifecycle boundary, seat count, and the checkout/' +
      'portal route paths. Lazily creates a fresh TRIAL subscription row on first call for a ' +
      'company that has never been touched yet (see company-subscription.store.ts). Before ' +
      'computing the view, gives Polar a chance to correct a stale local row that a failed webhook ' +
      'delivery never updated (see status-reconcile.ts) — a no-op on every call once the row is ' +
      'genuinely ACTIVE.',
  })
  @ApiResponse({ status: 200, description: 'Billing status computed' })
  async getStatus(@ActiveCompany() companyId: string): Promise<BillingStatusView> {
    const sub = await getOrCreateCompanySubscription(companyId);
    const reconciled = await reconcileFromPolarIfStale(sub);
    return computeBillingStatusView(reconciled);
  }

  @Post('portal')
  @ApiOperation({
    summary: "Open this user's Polar customer-portal session",
    description:
      "Replaces better-auth's own `/api/auth/customer/portal` route for this product — see " +
      "portal-session.ts's header for why that route is unconditionally broken for a seat-based " +
      'TEAM customer.',
  })
  @ApiResponse({ status: 201, description: 'Portal session URL' })
  async openPortal(@User() user: CurrentUser): Promise<PortalSessionResult> {
    return createCustomerPortalSession(user.id, FALLBACK_RETURN_URL());
  }
}
