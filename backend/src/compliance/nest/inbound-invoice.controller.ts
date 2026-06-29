/**
 * Inbound invoice endpoints — thin controller → InboundInvoiceService → PrismaService.
 *
 * Routes:
 *   GET    /compliance/received-invoices/:companyId           list (paginated)
 *   GET    /compliance/received-invoices/:companyId/:id       get one (+ raw payload)
 *   POST   /compliance/received-invoices/:companyId/:id/accept  accept
 *   POST   /compliance/received-invoices/:companyId/:id/reject  reject
 *   POST   /compliance/received-invoices/receive/:channel     webhook — store received doc
 *   POST   /compliance/documents/:id/refresh                  trigger one-off poll/reconcile
 */
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { Public } from '@/decorators/public.decorator';
import { InboundInvoiceService, ReceiveDocumentInput } from '../reception/inbound-invoice.service';
import { PollScheduler } from '../lifecycle/drivers/poll-scheduler';
import { PrismaComplianceDocumentStore } from '../persistence/prisma-document-store';

/**
 * Shared-secret gate (same as ComplianceController) for the document-receive webhook.
 * TODO: per-channel HMAC or mTLS once live credentials are in place.
 */
function assertWebhookSecret(secret: string | undefined): void {
  const expected = process.env.COMPLIANCE_WEBHOOK_SECRET;
  if (expected && secret !== expected) {
    throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
  }
}

interface RejectBody {
  reason?: string;
}

interface ReceiveWebhookBody {
  /** The receiving company's ID. */
  companyId: string;
  /** Authority-assigned document ID (for dedup). */
  externalId: string;
  /** Raw e-invoice payload (XML string or JSON string). */
  rawPayload: string;
  /** Optional DocumentSyntax hint (EN16931_CII | EN16931_UBL | FATTURAPA | FA_VAT | …). */
  syntax?: string;
  /** Optional sender endpoint / tax ID. */
  senderId?: string;
  /** Optional provider ID override (e.g. "superpdp"). */
  providerId?: string;
}

@Controller()
export class InboundInvoiceController {
  private readonly logger = new Logger(InboundInvoiceController.name);

  constructor(
    private readonly inboundInvoices: InboundInvoiceService,
    private readonly pollScheduler: PollScheduler,
    private readonly docStore: PrismaComplianceDocumentStore,
  ) {}

  // ---------------------------------------------------------------------------
  // Received invoices CRUD
  // ---------------------------------------------------------------------------

  @Get('compliance/received-invoices/:companyId')
  async list(
    @Param('companyId') companyId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const pageNum = Math.max(1, parseInt(page ?? '1', 10) || 1);
    const pageSizeNum = Math.min(100, Math.max(1, parseInt(pageSize ?? '20', 10) || 20));
    return this.inboundInvoices.list(companyId, pageNum, pageSizeNum);
  }

  @Get('compliance/received-invoices/:companyId/:id')
  getOne(@Param('companyId') companyId: string, @Param('id') id: string) {
    return this.inboundInvoices.getOne(id, companyId);
  }

  @Post('compliance/received-invoices/:companyId/:id/accept')
  @HttpCode(200)
  accept(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() body: RejectBody,
  ) {
    return this.inboundInvoices.acceptOrReject(id, companyId, 'accept', body?.reason);
  }

  @Post('compliance/received-invoices/:companyId/:id/reject')
  @HttpCode(200)
  reject(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() body: RejectBody,
  ) {
    return this.inboundInvoices.acceptOrReject(id, companyId, 'reject', body?.reason);
  }

  // ---------------------------------------------------------------------------
  // Document-receive webhook (used by channels to push inbound invoices to us)
  // ---------------------------------------------------------------------------

  /**
   * POST /compliance/received-invoices/receive/:channel
   *
   * A channel provider (PDP, SdI intermediary, Peppol AP, KSeF webhook) pushes a
   * received supplier invoice here. The body contains the raw e-invoice payload
   * plus metadata (companyId, externalId).
   *
   * Authentication: shared secret via `x-compliance-secret` header.
   * TODO: per-channel HMAC or mTLS for production hardening.
   */
  @Public()
  @Post('compliance/received-invoices/receive/:channel')
  @HttpCode(200)
  async receiveDocument(
    @Param('channel') channel: string,
    @Body() body: ReceiveWebhookBody,
    @Headers('x-compliance-secret') secret?: string,
  ) {
    assertWebhookSecret(secret);

    if (!body.companyId || !body.externalId || !body.rawPayload) {
      this.logger.warn(`inbound-doc/${channel}: missing required fields (companyId|externalId|rawPayload)`);
      return { kind: 'IGNORED', reason: 'missing required fields' };
    }

    const input: ReceiveDocumentInput = {
      companyId: body.companyId,
      channel: channel.toUpperCase(),
      providerId: body.providerId,
      externalId: body.externalId,
      rawPayload: body.rawPayload,
      syntax: body.syntax,
      senderId: body.senderId,
    };

    const result = await this.inboundInvoices.receiveDocument(input);
    this.logger.log(`inbound-doc/${channel}: ${result.kind} id=${result.id}`);
    return result;
  }

  // ---------------------------------------------------------------------------
  // Refresh status — manual one-off poll/reconcile for an outbound compliance doc
  // ---------------------------------------------------------------------------

  /**
   * POST /compliance/documents/:id/refresh
   *
   * Trigger an immediate poll/reconcile for a single compliance document.
   * Useful when the user wants to manually refresh the status of a submitted invoice
   * without waiting for the next cron tick.
   *
   * Finds all PENDING poll jobs for the document and runs them immediately.
   */
  @Post('compliance/documents/:id/refresh')
  @HttpCode(200)
  async refreshDocument(@Param('id') documentId: string) {
    // Verify document exists
    const doc = await this.docStore.get(documentId);
    if (!doc) throw new HttpException('Compliance document not found', HttpStatus.NOT_FOUND);

    // Trigger reconcile for all pending poll jobs (scoped to this document via provider)
    // PollScheduler.reconcile() polls ALL pending jobs; for a UI-triggered refresh this
    // is acceptable since it's an infrequent operator action.
    const report = await this.pollScheduler.reconcile();

    this.logger.log(`refresh document ${documentId}: reconcile report=${JSON.stringify(report)}`);
    return {
      documentId,
      status: doc.status,
      reconcile: report,
    };
  }
}
