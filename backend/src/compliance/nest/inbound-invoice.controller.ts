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
 *   POST   /compliance/documents/:id/retry                    re-enqueue a TRANSMISSION_FAILED doc
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
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { ActiveCompany } from '@/decorators/active-company.decorator';
import { Public } from '@/decorators/public.decorator';
import { InboundInvoiceService, ReceiveDocumentInput } from '../reception/inbound-invoice.service';
import { PollScheduler } from '../lifecycle/drivers/poll-scheduler';
import { PrismaComplianceDocumentStore } from '../persistence/prisma-document-store';
import { ComplianceQueueDispatcher } from './queue/compliance-queue.dispatcher';
import { assertWebhookAuth } from './webhook-auth';

/**
 * Extract the raw body bytes from the request for HMAC verification.
 * Mirrors ComplianceController's helper (main.ts's bodyParser `verify` callback attaches the
 * raw bytes to `req.rawBody`; falls back to re-serialising the parsed body).
 */
function getRawBody(req: Request, parsedBody: unknown): Buffer {
  const raw = (req as any).rawBody;
  if (raw instanceof Buffer) return raw;
  return Buffer.from(JSON.stringify(parsedBody) ?? '', 'utf-8');
}

/** Extract remote IP from the request, honouring X-Forwarded-For (set by a trusted reverse-proxy). */
function getRemoteIp(req: Request): string | undefined {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0];
    return first?.trim();
  }
  return req.socket?.remoteAddress;
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
    private readonly dispatcher: ComplianceQueueDispatcher,
  ) {}

  // ---------------------------------------------------------------------------
  // Received invoices CRUD — always scoped to the caller's active company (never
  // the URL's :companyId, which is only kept for URL-shape/backwards compat).
  // ---------------------------------------------------------------------------

  @Get('compliance/received-invoices/:companyId')
  async list(
    @ActiveCompany() companyId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const pageNum = Math.max(1, parseInt(page ?? '1', 10) || 1);
    const pageSizeNum = Math.min(100, Math.max(1, parseInt(pageSize ?? '20', 10) || 20));
    return this.inboundInvoices.list(companyId, pageNum, pageSizeNum);
  }

  @Get('compliance/received-invoices/:companyId/:id')
  getOne(@ActiveCompany() companyId: string, @Param('id') id: string) {
    return this.inboundInvoices.getOne(id, companyId);
  }

  @Post('compliance/received-invoices/:companyId/:id/accept')
  @HttpCode(200)
  accept(@ActiveCompany() companyId: string, @Param('id') id: string, @Body() body: RejectBody) {
    return this.inboundInvoices.acceptOrReject(id, companyId, 'accept', body?.reason);
  }

  @Post('compliance/received-invoices/:companyId/:id/reject')
  @HttpCode(200)
  reject(@ActiveCompany() companyId: string, @Param('id') id: string, @Body() body: RejectBody) {
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
   * Authentication: HMAC-SHA256 via X-Signature header (preferred) or X-Compliance-Secret
   * fallback, plus an optional per-channel IP allowlist — see webhook-auth.ts. Same scheme as
   * ComplianceController's inbound endpoints.
   */
  @Public()
  @Post('compliance/received-invoices/receive/:channel')
  @HttpCode(200)
  async receiveDocument(
    @Param('channel') channel: string,
    @Body() body: ReceiveWebhookBody,
    @Req() req: Request,
    @Headers('x-signature') sigHeader?: string,
    @Headers('x-compliance-secret') secretHeader?: string,
  ) {
    assertWebhookAuth({
      channel: channel.toUpperCase(),
      rawBody: getRawBody(req, body),
      signatureHeader: sigHeader,
      sharedSecretHeader: secretHeader,
      remoteIp: getRemoteIp(req),
    });

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
  async refreshDocument(@ActiveCompany() companyId: string, @Param('id') documentId: string) {
    // Verify document exists
    const doc = await this.docStore.get(documentId);
    if (!doc) throw new HttpException('Compliance document not found', HttpStatus.NOT_FOUND);

    // Ownership check: ctx.supplierCompanyId is always set at issuance (see
    // invoices.helpers.ts / quotes.service.ts) for outbound documents. A foreign (or ctx-missing)
    // document is reported as 404 — identical to a nonexistent one — so a caller cannot probe
    // another tenant's document ids by telling a 403 apart from a 404.
    if (doc.ctx?.supplierCompanyId !== companyId) {
      throw new HttpException('Compliance document not found', HttpStatus.NOT_FOUND);
    }

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

  // ---------------------------------------------------------------------------
  // Retry — manual resend for a document stuck in TRANSMISSION_FAILED (Phase 4,
  // QUEUE_IMPL_PLAN.md §5.9)
  // ---------------------------------------------------------------------------

  /**
   * POST /compliance/documents/:id/retry
   *
   * Re-enqueue a `compliance-transmit` job for a document currently in TRANSMISSION_FAILED —
   * i.e. "no channel accepted the document" on the previous attempt (F-4, ComplianceService.send()'s
   * honesty guard). The TransmitProcessor (queue/processors/transmit.processor.ts) re-runs
   * `computeSendOutcome` for real (the same executor/registry path as the original send) and
   * advances the document via `ApplySignalService.apply()` on success.
   *
   * `enqueueTransmit` uses a deterministic jobId (`transmit-<documentId>`) so a double-click (or a
   * retry racing an already-enqueued job) is a no-op, not a duplicate transmission.
   */
  @Post('compliance/documents/:id/retry')
  @HttpCode(200)
  async retryDocument(@ActiveCompany() companyId: string, @Param('id') documentId: string) {
    // Verify document exists
    const doc = await this.docStore.get(documentId);
    if (!doc) throw new HttpException('Compliance document not found', HttpStatus.NOT_FOUND);

    // Ownership check — identical pattern to refreshDocument() above (404, not 403, so a foreign
    // document id is indistinguishable from a nonexistent one — no existence probing).
    if (doc.ctx?.supplierCompanyId !== companyId) {
      throw new HttpException('Compliance document not found', HttpStatus.NOT_FOUND);
    }

    if (doc.status !== 'TRANSMISSION_FAILED') {
      throw new HttpException(
        `Cannot retry document "${documentId}" in status ${doc.status}; expected TRANSMISSION_FAILED`,
        HttpStatus.CONFLICT,
      );
    }

    await this.dispatcher.enqueueTransmit(documentId);

    this.logger.log(`retry document ${documentId}: enqueued compliance-transmit`);
    return {
      documentId,
      status: doc.status,
      enqueued: true,
    };
  }
}
