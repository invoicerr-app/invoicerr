/**
 * Registered only when `BillingModule` is imported behind the billing flag, so without the flag these
 * routes 404. Checkout lives here rather than in better-auth because its `checkout()` hard-codes the
 * user id as the external customer id, while billing uses per-company customers.
 */
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Post,
  Put,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { ActiveCompany } from '@/decorators/active-company.decorator';
import { LegalGateExempt } from '@/legal/legal-gate-exempt.decorator';
import { Roles } from '@/decorators/roles.decorator';
import { User } from '@/decorators/user.decorator';
import { CurrentUser } from '@/types/user';
import { RequiresScope } from '@/utils/scope-check';

import { CompanyRole } from '../../../prisma/generated/prisma/client';
import {
  BillingEmailTakenError,
  loadCompanyBillingIdentity,
  MissingBillingEmailError,
  resolveBillingEmail,
} from './billing-customer';
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
import { getCompanyCustomerFacts, hasLegacyPolarCustomer } from './legacy-customer';
import { FALLBACK_RETURN_URL } from './portal-return-url';
import {
  createCustomerPortalSession,
  createLegacyCustomerPortalSession,
  PolarCustomerNotFoundError,
  PortalSessionResult,
} from './portal-session';
import { reconcileFromPolarIfStale } from './status-reconcile';

/** Adds the one field scoped to the calling user rather than the company. */
export interface BillingStatusViewResponse extends BillingStatusView {
  /** Whether the pre-migration per-user Polar portal can be opened; always `false` unless legacy. */
  legacyPortalAvailable: boolean;
}

const CHECKOUT_SLUGS: readonly CheckoutProductSlug[] = ['monthly', 'yearly'];

@ApiTags('billing')
@Controller('billing')
export class BillingController {
  @Get('status')
  @RequiresScope('billing:read')
  @ApiOperation({
    summary: "This company's hosted-billing status",
    description:
      'Status, days remaining until the next lifecycle boundary, seat count, the checkout/portal ' +
      'route paths, whether this company has its own Polar customer yet, and whether this is a ' +
      'pre-migration subscription that needs re-subscribing under the company. Lazily creates a fresh ' +
      'TRIAL subscription row on first call for a company that has never been touched yet (see ' +
      'company-subscription.store.ts). Before computing the view, gives Polar a chance to correct a ' +
      'stale local row that a failed webhook delivery never updated (see status-reconcile.ts) — a ' +
      'no-op on every call once the row is genuinely ACTIVE.',
  })
  @ApiResponse({ status: 200, description: 'Billing status computed' })
  async getStatus(
    @ActiveCompany() companyId: string,
    @User() user: CurrentUser,
  ): Promise<BillingStatusViewResponse> {
    const sub = await getOrCreateCompanySubscription(companyId);
    const reconciled = await reconcileFromPolarIfStale(sub);
    const facts = await getCompanyCustomerFacts(reconciled);
    // Only checked while legacy, so ordinary status polls never pay for the extra Polar call.
    const legacyPortalAvailable = facts.legacySubscription ? await hasLegacyPolarCustomer(user.id) : false;
    return { ...computeBillingStatusView(reconciled, facts), legacyPortalAvailable };
  }

  @Post('checkout')
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN)
  @RequiresScope('billing:write')
  @BillingGateExempt()
  // Deliberately not legal-gate exempt: starting a subscription is not part of the termination path.
  @ApiOperation({
    summary: 'Start a Polar checkout session for the active company',
    description:
      'OWNER/ADMIN only — a MEMBER never touches Polar directly (they only count as a billed seat, ' +
      "seat-sync.ts). Ensures the company's own Polar customer exists first (option A: one customer " +
      'per company, never per user — see checkout-session.ts / billing-customer.ts). Refuses (409, ' +
      'BILLING_EMAIL_TAKEN) when another Polar customer already uses the resolved billing email — set ' +
      'a distinct Company.billingEmail (PUT /billing/billing-email) and retry. Refuses (422, ' +
      'BILLING_EMAIL_MISSING) when this company has no billing email at all yet, BEFORE ever calling ' +
      'Polar with one (see billing-customer.ts MissingBillingEmailError — this used to reach Polar as ' +
      'an empty string and come back as an unhandled 500).',
  })
  @ApiResponse({ status: 201, description: 'Checkout session URL' })
  @ApiResponse({ status: 422, description: 'This company has no billing email set' })
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
        // 409, not 403: these are data conflicts, not permission refusals. The `code` lets the
        // frontend branch on the specific refusal.
        throw new ConflictException({ message: error.message, code: error.code });
      }
      if (error instanceof MissingBillingEmailError) {
        // 422: the company's data is incomplete for this request, not in conflict. The message is
        // meant for the user, so it is passed through as the body.
        throw new UnprocessableEntityException({ message: error.message, code: error.code });
      }
      throw error;
    }
  }

  @Post('portal')
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN)
  @RequiresScope('billing:write')
  @BillingGateExempt()
  // This is the in-product cancellation flow the Terms commit to keeping open, so a pending legal
  // re-acceptance must not block it (`@BillingGateExempt()` covers the separate billing guard).
  @LegalGateExempt()
  @ApiOperation({
    summary: "Open a Polar customer-portal session under THIS COMPANY's own billing identity",
    description:
      "Replaces better-auth's own `/api/auth/customer/portal` route for this product — see " +
      "portal-session.ts's header for why that route is unconditionally broken for a seat-based " +
      'TEAM customer. Scoped by COMPANY, never by user: the session opens for the Polar member ' +
      "standing for the company's own resolved billing email (`billing-email.ts`), never for " +
      "whichever OWNER/ADMIN happens to click — see portal-session.ts's own header for the real " +
      'incident this fixed. Reachable only by OWNER/ADMIN in the first place; a MEMBER never reaches ' +
      'this route at all. Refuses (409, BILLING_NO_COMPANY_CUSTOMER) when this company has no Polar ' +
      'customer yet — check `hasCompanyCustomer` on GET /billing/status before offering this action.',
  })
  @ApiResponse({ status: 201, description: 'Portal session URL' })
  @ApiResponse({ status: 409, description: 'This company has no Polar customer yet' })
  @ApiResponse({ status: 422, description: 'This company has no billing email set' })
  async openPortal(@ActiveCompany() companyId: string): Promise<PortalSessionResult> {
    try {
      const identity = await loadCompanyBillingIdentity(companyId);
      return await createCustomerPortalSession(
        companyId,
        { email: resolveBillingEmail(identity), name: identity.name },
        FALLBACK_RETURN_URL(),
      );
    } catch (error) {
      if (error instanceof PolarCustomerNotFoundError) {
        // 409: a data-state conflict the frontend shows as its own translated notice.
        throw new ConflictException({ message: error.message, code: error.code });
      }
      if (error instanceof MissingBillingEmailError) {
        // Only when a `team` customer's billing email went blank after promotion, so no member matches.
        throw new UnprocessableEntityException({ message: error.message, code: error.code });
      }
      throw error;
    }
  }

  @Post('portal/legacy')
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN)
  @RequiresScope('billing:write')
  @BillingGateExempt()
  // The legacy half of the same cancellation flow as `openPortal`.
  @LegalGateExempt()
  @ApiOperation({
    summary: "Open a Polar customer-portal session for the CALLING user's own PRE-MIGRATION customer",
    description:
      'For a `legacySubscription: true` company only — lets the OWNER/ADMIN cancel the OLD, ' +
      'per-USER Polar subscription by hand after re-subscribing under the company (there is no Polar ' +
      'API to migrate it automatically — see legacy-customer.ts). Refuses (409, ' +
      'BILLING_NO_COMPANY_CUSTOMER) when no Polar customer is registered at this user id at all — ' +
      'check `legacyPortalAvailable` on GET /billing/status before offering this action.',
  })
  @ApiResponse({ status: 201, description: 'Legacy portal session URL' })
  @ApiResponse({ status: 409, description: 'This user has no legacy Polar customer' })
  async openLegacyPortal(@User() user: CurrentUser): Promise<PortalSessionResult> {
    try {
      return await createLegacyCustomerPortalSession(
        { id: user.id, email: user.email, name: `${user.firstname} ${user.lastname}`.trim() || null },
        FALLBACK_RETURN_URL(),
      );
    } catch (error) {
      if (error instanceof PolarCustomerNotFoundError) {
        throw new ConflictException({ message: error.message, code: error.code });
      }
      throw error;
    }
  }

  @Get('billing-email')
  @RequiresScope('billing:read')
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
  @RequiresScope('billing:write')
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
