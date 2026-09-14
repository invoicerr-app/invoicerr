import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { ActiveCompany } from '@/decorators/active-company.decorator';

import { PaymentSessionsService } from './payment-sessions.service';

/**
 * TODO_FEATURES.md rank 1 ("paiement en ligne") — the STAFF-facing half. Company-authenticated
 * (`@ActiveCompany()`, the global `AuthGuard`/`RolesGuard` apply as usual — no `@Public()` here),
 * unlike `PaymentsWebhookController` right next to it. A bespoke top-level path (`/payments/...`),
 * never folded into `documents.controller.ts`'s own generic `:id/...` routes — the same
 * "no generic-document counterpart at all" reasoning `BankReconciliationController`'s own header
 * already gives for its bespoke routes: a checkout session is not a `DocumentInstance`, and this read
 * has no notion of `typeId` (only "invoice" ever grows one).
 *
 * No product screen renders this today — see `PaymentSessionsService.listSessionsForDocument`'s own
 * header on why it exists anyway (support/troubleshooting, and this feature's own e2e spec).
 */
@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentSessions: PaymentSessionsService) {}

  @Get(':documentId/sessions')
  @ApiOperation({
    summary: "One invoice's own checkout sessions",
    description:
      'Every session ever opened for this invoice, most recently opened first — status only, never a ' +
      "provider credential. Company-scoped: another company's documentId resolves to an empty list.",
  })
  @ApiParam({ name: 'documentId', type: String })
  @ApiResponse({ status: 200, description: 'Sessions retrieved' })
  listSessions(@ActiveCompany() companyId: string, @Param('documentId') documentId: string) {
    return this.paymentSessions.listSessionsForDocument(companyId, documentId);
  }
}
