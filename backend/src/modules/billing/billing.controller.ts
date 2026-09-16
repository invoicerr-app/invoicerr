/**
 * `GET /api/billing/status`, `POST /api/billing/checkout`, `POST /api/billing/portal`, and
 * `GET`/`PUT /api/billing/billing-email` — the routes this feature adds to Nest's own controller
 * layer. ALL FOUR are real Nest routes now (option A, product decision 2026-09-16): checkout and
 * portal used to be split between better-auth's own `/api/auth/*` middleware (checkout) and this
 * controller (portal, moved here originally because that route cannot supply `memberId` — see
 * `portal-session.ts`'s own header) — checkout joined portal here for the SAME underlying reason
 * once billing moved to per-COMPANY Polar customers: `@polar-sh/better-auth`'s `checkout()` hard-codes
 * `externalCustomerId: session.user.id` with no way to override it (`checkout-session.ts`'s own
 * header). This controller is registered ONLY when `BillingModule` itself is imported
 * (`app.module.ts`, behind the flag) — so with the flag absent, none of these routes exist at all and
 * Nest's own catch-all answers 404.
 *
 * `checkout`/`portal` both carry `@BillingGateExempt()` (`billing-gate-exempt.decorator.ts`) — see
 * that decorator's own header for why a BLOCKED company must still be able to reach them.
 */
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Post,
  Put,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { ActiveCompany } from '@/decorators/active-company.decorator';
import { Roles } from '@/decorators/roles.decorator';
import { User } from '@/decorators/user.decorator';
import { CurrentUser } from '@/types/user';

import { CompanyRole } from '../../../prisma/generated/prisma/client';
import { BillingEmailTakenError } from './billing-customer';
import { BillingGateExempt } from './billing-gate-exempt.decorator';
import { BillingEmailView, getCompanyBillingEmail, setCompanyBillingEmail } from './billing-email';
import { SetBillingEmailDto, StartCheckoutDto } from './billing.dto';
import { BillingStatusView, computeBillingStatusView } from './billing-status-view';
import {
  CheckoutAlreadyInProgressError,
  CheckoutProductSlug,
  CheckoutSessionResult,
  createCheckoutSession,
  SubscriptionAlreadyActiveError,
} from './checkout-session';
import { getOrCreateCompanySubscription } from './company-subscription.store';
import { isLegacyUserLevelSubscription } from './legacy-customer';
import { FALLBACK_RETURN_URL } from './portal-return-url';
import {
  createCustomerPortalSession,
  PolarCustomerNotFoundError,
  PortalSessionResult,
} from './portal-session';
import { reconcileFromPolarIfStale } from './status-reconcile';

/** `BillingStatusView` plus the ONE field computed outside that pure function — kept out of
 *  `billing-status-view.ts` itself so its own spec never has to mock a Polar client (this field is the
 *  only one in the whole response that ever calls Polar — see `legacy-customer.ts`'s own header). */
export interface BillingStatusViewResponse extends BillingStatusView {
  /** `true` when this company's stored subscription still points at the pre-2026-09-16 per-USER Polar
   *  customer — see `legacy-customer.ts`'s own header. The settings screen shows a re-subscribe
   *  notice instead of trying (there is no Polar API to migrate an existing subscription). */
  legacySubscription: boolean;
}

const CHECKOUT_SLUGS: readonly CheckoutProductSlug[] = ['monthly', 'yearly'];

@ApiTags('billing')
@Controller('billing')
export class BillingController {
  @Get('status')
  @ApiOperation({
    summary: "This company's hosted-billing status",
    description:
      'Status, days remaining until the next lifecycle boundary, seat count, the checkout/portal ' +
      'route paths, and whether this is a pre-migration subscription that needs re-subscribing under ' +
      'the company. Lazily creates a fresh TRIAL subscription row on first call for a company that has ' +
      'never been touched yet (see company-subscription.store.ts). Before computing the view, gives ' +
      'Polar a chance to correct a stale local row that a failed webhook delivery never updated (see ' +
      'status-reconcile.ts) — a no-op on every call once the row is genuinely ACTIVE.',
  })
  @ApiResponse({ status: 200, description: 'Billing status computed' })
  async getStatus(@ActiveCompany() companyId: string): Promise<BillingStatusViewResponse> {
    const sub = await getOrCreateCompanySubscription(companyId);
    const reconciled = await reconcileFromPolarIfStale(sub);
    const legacySubscription = await isLegacyUserLevelSubscription(reconciled);
    return { ...computeBillingStatusView(reconciled), legacySubscription };
  }

  @Post('checkout')
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN)
  @BillingGateExempt()
  @ApiOperation({
    summary: 'Start a Polar checkout session for the active company',
    description:
      'OWNER/ADMIN only — a MEMBER never touches Polar directly (they only count as a billed seat, ' +
      "seat-sync.ts). Ensures the company's own Polar customer exists first (option A: one customer " +
      'per company, never per user — see checkout-session.ts / billing-customer.ts). Refuses (409, ' +
      'BILLING_EMAIL_TAKEN) when another Polar customer already uses the resolved billing email — set ' +
      'a distinct Company.billingEmail (PUT /billing/billing-email) and retry.',
  })
  @ApiResponse({ status: 201, description: 'Checkout session URL' })
  async startCheckout(
    @ActiveCompany() companyId: string,
    @Body() body: StartCheckoutDto,
  ): Promise<CheckoutSessionResult> {
    if (!CHECKOUT_SLUGS.includes(body.slug)) {
      throw new BadRequestException(`Unknown checkout slug "${body.slug}" — expected "monthly" or "yearly".`);
    }
    try {
      return await createCheckoutSession({
        companyId,
        slug: body.slug,
        successUrl: body.successUrl || FALLBACK_RETURN_URL(),
        returnUrl: body.returnUrl || FALLBACK_RETURN_URL(),
      });
    } catch (error) {
      if (
        error instanceof BillingEmailTakenError ||
        error instanceof SubscriptionAlreadyActiveError ||
        error instanceof CheckoutAlreadyInProgressError
      ) {
        // 409, not 403 — every one of these is a data conflict (a duplicate email, a subscription
        // that already exists, a checkout already in flight), not a permission refusal. Same
        // `{ message, code }` shape write-gate.ts's own COMPANY_BLOCKED already established as this
        // codebase's convention for a machine-readable refusal a frontend can branch on
        // (use-mutation-with-toast.ts's own header).
        throw new ConflictException({ message: error.message, code: error.code });
      }
      throw error;
    }
  }

  @Post('portal')
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN)
  @BillingGateExempt()
  @ApiOperation({
    summary: 'Open a Polar customer-portal session for the CALLING OWNER/ADMIN',
    description:
      "Replaces better-auth's own `/api/auth/customer/portal` route for this product — see " +
      "portal-session.ts's header for why that route is unconditionally broken for a seat-based " +
      'TEAM customer. Scoped by COMPANY, never by user, but the session itself opens for the Polar ' +
      'MEMBER matching the CALLING user (created on demand if none matches yet) — never ' +
      'unconditionally the auto-created owner. A MEMBER never reaches this route at all.',
  })
  @ApiResponse({ status: 201, description: 'Portal session URL' })
  @ApiResponse({ status: 404, description: 'This company has no Polar customer yet' })
  async openPortal(
    @ActiveCompany() companyId: string,
    @User() user: CurrentUser,
  ): Promise<PortalSessionResult> {
    try {
      return await createCustomerPortalSession(
        companyId,
        { id: user.id, email: user.email, name: `${user.firstname} ${user.lastname}`.trim() || null },
        FALLBACK_RETURN_URL(),
      );
    } catch (error) {
      if (error instanceof PolarCustomerNotFoundError) throw new NotFoundException(error.message);
      throw error;
    }
  }

  @Get('billing-email')
  @ApiOperation({
    summary: "This company's billing email override",
    description:
      "The Polar billing email used for THIS company's customer, and the fallback contact email it " +
      'defaults to when no override is set — see billing-email.ts / billing-customer.ts.',
  })
  @ApiResponse({ status: 200, description: 'Billing email view' })
  async getBillingEmail(@ActiveCompany() companyId: string): Promise<BillingEmailView> {
    return getCompanyBillingEmail(companyId);
  }

  @Put('billing-email')
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN)
  @ApiOperation({
    summary: "Set (or clear) this company's billing email override",
    description:
      'Never talks to Polar — a duplicate-email refusal can only be discovered at checkout time ' +
      '(BILLING_EMAIL_TAKEN, POST /billing/checkout).',
  })
  @ApiResponse({ status: 200, description: 'Billing email updated' })
  async setBillingEmail(
    @ActiveCompany() companyId: string,
    @Body() body: SetBillingEmailDto,
  ): Promise<BillingEmailView> {
    return setCompanyBillingEmail(companyId, body.billingEmail ?? null);
  }
}
