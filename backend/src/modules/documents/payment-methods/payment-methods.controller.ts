import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { ActiveCompany } from '@/decorators/active-company.decorator';
import { Roles } from '@/decorators/roles.decorator';
import { RequiresScope } from '@/utils/scope-check';

import { CompanyRole } from '../../../../prisma/generated/prisma/client';
import { UpdatePaymentMethodConfigInput } from './persistence';
import { PaymentMethodsService } from './payment-methods.service';

/**
 * The payment-methods screen's own controller — company-authenticated (`@ActiveCompany()`, the
 * global `AuthGuard`/`RolesGuard` apply as usual, no `@Public()`), a first-class top-level entity in
 * the frontend's own navigation (next to Clients/Articles), never a settings-screen tab — see
 * `frontend/src/pages/(app)/payment-methods/index.tsx`. A bespoke top-level path (`/payment-methods`),
 * the same "no generic-document counterpart" reasoning `PaymentsController`'s own header already
 * gives: a payment method is not a `DocumentInstance`, has no `typeId`, and belongs to the company
 * itself, not to one document.
 *
 * Gated on `company:*` rather than a scope of its own, because that is literally what these routes
 * read and write: `bank_transfer`'s config fields ARE `Company.iban`/`Company.bic` (persistence.ts
 * bridges them into that row), the very two columns `company.controller.ts#postCompanyInfo` already
 * holds behind `@Roles(OWNER, ADMIN)` + `@RequiresScope('company:write')`. Leaving this side ungated
 * left the same data with two doors and one lock: an API key minted for an unrelated resource (a
 * read-only catalogue key, say) could set the IBAN printed on every invoice and switch the method on,
 * re-pointing the company's incoming payments at an account of the caller's choosing — the PayPal
 * descriptor's `email` is the payee of the payment link in exactly the same way. Reads are open to
 * any active-company ROLE, the same posture `branding.controller.ts` and `channels.controller.ts`
 * hold for their own GETs (a document screen resolves a payment's method label through this list);
 * only the write is narrowed to OWNER/ADMIN, like every other company-setting write.
 */
@ApiTags('payment-methods')
@Controller('payment-methods')
export class PaymentMethodsController {
  constructor(private readonly paymentMethods: PaymentMethodsService) {}

  @Get()
  @RequiresScope('company:read')
  @ApiOperation({
    summary: "Every registered payment method, and this company's own configuration for each",
    description:
      'Always the full registered list (BUILT_IN_PAYMENT_METHODS), configured or not — never filtered ' +
      'down to only the enabled ones: the screen needs to offer every method, not just the ones already ' +
      "on. Each entry's own `configured` says whether its current `config` already satisfies every " +
      'field the method requires — the settings screen uses it to decide whether flipping a method on ' +
      'can go straight through, or needs its config dialog first.',
  })
  @ApiResponse({ status: 200, description: 'Payment methods retrieved' })
  list(@ActiveCompany() companyId: string) {
    return this.paymentMethods.listForCompany(companyId);
  }

  @Patch(':methodId')
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN)
  @RequiresScope('company:write')
  @ApiOperation({
    summary: "Update this company's own configuration for one payment method",
    description:
      '`enabled` and `config` are each independently optional — a plain enable/disable toggle sends ' +
      'only `enabled`; the config dialog sends both. `config`, when sent, REPLACES the stored value ' +
      'wholesale. A method left `enabled: true` must carry every field it declares required, or this ' +
      'is refused (400) — see persistence.ts#updateCompanyPaymentMethodConfig.',
  })
  @ApiParam({ name: 'methodId', type: String })
  @ApiResponse({ status: 200, description: 'Payment method updated' })
  @ApiResponse({ status: 403, description: 'Not an OWNER/ADMIN, or an API key without company:write' })
  update(
    @ActiveCompany() companyId: string,
    @Param('methodId') methodId: string,
    @Body() body: UpdatePaymentMethodConfigInput,
  ) {
    return this.paymentMethods.updateConfig(companyId, methodId, body);
  }

  /**
   * Issue #416 - "payment methods per client". Gated on `clients:*` rather than `company:*` (unlike
   * every route above): this reads/writes a fact ABOUT ONE CLIENT RECORD, the same scope
   * `clients.controller.ts`'s own `PATCH :id` and `portal-access.controller.ts` already use for the
   * identical "a per-client setting, not a company-wide one" reasoning - never restricted to
   * OWNER/ADMIN, the same posture `PATCH /clients/:id` itself holds for an ordinary client edit.
   *
   * `clientId` is a literal path SEGMENT after `payment-methods/`, never collapsed into the existing
   * `:methodId` route above - Nest matches by segment COUNT, so `GET /payment-methods/clients/:id`
   * (two segments after the controller's own `payment-methods` prefix) can never be mistaken for
   * `PATCH /payment-methods/:methodId` (one segment) regardless of declaration order.
   */
  @Get('clients/:clientId')
  @RequiresScope('clients:read')
  @ApiOperation({
    summary: "One client's own payment-method restriction",
    description:
      '`methodIds: []` means UNRESTRICTED - every company-enabled method is offered to this client, ' +
      'exactly as for a client with no restriction configured at all. A non-empty array narrows the ' +
      'client to exactly those ids, intersected at READ time with whatever the company currently has ' +
      'enabled (see persistence.ts#resolveEnabledPaymentMethodPresentations).',
  })
  @ApiParam({ name: 'clientId', type: String })
  @ApiResponse({ status: 200, description: "Client's payment-method restriction retrieved" })
  @ApiResponse({ status: 404, description: 'Client not found for this company' })
  listForClient(@ActiveCompany() companyId: string, @Param('clientId') clientId: string) {
    return this.paymentMethods
      .listClientRestrictions(companyId, clientId)
      .then((methodIds) => ({ methodIds }));
  }

  @Patch('clients/:clientId')
  @RequiresScope('clients:write')
  @ApiOperation({
    summary: "Replaces one client's own payment-method restriction wholesale",
    description:
      '`methodIds` REPLACES the stored set entirely - the same "a submitted form is a full snapshot" ' +
      "convention this module already holds for a method's own `config` (see persistence.ts#" +
      'setClientPaymentMethodRestrictions). An empty array explicitly clears the restriction (back to ' +
      '"every company-enabled method"). Every id must resolve against the registered payment methods ' +
      '(400 otherwise) - never checked against which ones the COMPANY currently has enabled, so ' +
      'restricting a client to a method before the company itself turns it on is accepted, not refused.',
  })
  @ApiParam({ name: 'clientId', type: String })
  @ApiResponse({ status: 200, description: "Client's payment-method restriction updated" })
  @ApiResponse({ status: 400, description: 'An unknown methodId was named' })
  @ApiResponse({ status: 404, description: 'Client not found for this company' })
  updateForClient(
    @ActiveCompany() companyId: string,
    @Param('clientId') clientId: string,
    @Body() body: { methodIds?: string[] },
  ) {
    const methodIds = Array.isArray(body?.methodIds) ? body.methodIds : [];
    return this.paymentMethods
      .updateClientRestrictions(companyId, clientId, methodIds)
      .then((updated) => ({ methodIds: updated }));
  }
}
