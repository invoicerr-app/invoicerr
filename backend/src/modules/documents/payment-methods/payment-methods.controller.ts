import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { ActiveCompany } from '@/decorators/active-company.decorator';

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
 */
@ApiTags('payment-methods')
@Controller('payment-methods')
export class PaymentMethodsController {
  constructor(private readonly paymentMethods: PaymentMethodsService) {}

  @Get()
  @ApiOperation({
    summary: "Every registered payment method, and this company's own configuration for each",
    description:
      'Always the full registered list (BUILT_IN_PAYMENT_METHODS), configured or not — never filtered ' +
      'down to only the enabled ones: the screen needs to offer every method, not just the ones already ' +
      'on.',
  })
  @ApiResponse({ status: 200, description: 'Payment methods retrieved' })
  list(@ActiveCompany() companyId: string) {
    return this.paymentMethods.listForCompany(companyId);
  }

  @Patch(':methodId')
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
  update(
    @ActiveCompany() companyId: string,
    @Param('methodId') methodId: string,
    @Body() body: UpdatePaymentMethodConfigInput,
  ) {
    return this.paymentMethods.updateConfig(companyId, methodId, body);
  }
}
