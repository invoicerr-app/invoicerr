/**
 * InboundInvoiceService — persistence + lifecycle for received supplier invoices.
 *
 * Layering: controller → this service → PrismaService (never Prisma in controllers).
 *
 * Receive flow:
 *   1. Dedup by (channel, externalId) — if already stored, return existing record.
 *   2. Parse payload structurally → canonical fields.
 *   3. Persist InboundInvoice with status RECEIVED (→ PARSED on success).
 *
 * Accept/reject flow:
 *   4. Update status → ACCEPTED | REJECTED.
 *   5. Emit buyer-status ack via the `sendStatus` seam (TODO: live per channel).
 */
import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { InboundInvoiceStatus } from '../../../prisma/generated/prisma/client';
import { parseInboundDocument } from './inbound-document-parser';

export interface ReceiveDocumentInput {
  companyId: string;
  channel: string;
  providerId?: string;
  externalId: string;
  rawPayload: string;
  syntax?: string;
  senderId?: string;
}

export interface ReceiveDocumentResult {
  kind: 'STORED' | 'DUPLICATE';
  id: string;
}

const PAGE_SIZE = 20;

@Injectable()
export class InboundInvoiceService {
  private readonly logger = new Logger(InboundInvoiceService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Receive a supplier invoice document.
   * Deduped by (channel, externalId); if already present returns DUPLICATE with the existing id.
   */
  async receiveDocument(input: ReceiveDocumentInput): Promise<ReceiveDocumentResult> {
    const { companyId, channel, providerId, externalId, rawPayload, syntax, senderId } = input;

    // Dedup check
    const existing = await this.prisma.inboundInvoice.findUnique({
      where: { channel_externalId: { channel, externalId } },
      select: { id: true },
    });
    if (existing) {
      this.logger.log(`InboundInvoice: duplicate ${channel}:${externalId} — skipped`);
      return { kind: 'DUPLICATE', id: existing.id };
    }

    // Parse payload
    const parsed = parseInboundDocument(rawPayload, syntax);
    const hasParsed =
      parsed.invoiceNumber != null ||
      parsed.sellerName != null ||
      parsed.sellerTaxId != null ||
      parsed.totalGross != null;
    const status: InboundInvoiceStatus = hasParsed ? 'PARSED' : 'RECEIVED';

    if (parsed.parseErrors.length > 0) {
      this.logger.warn(`InboundInvoice: parse errors for ${channel}:${externalId}: ${parsed.parseErrors.join('; ')}`);
    }

    const row = await this.prisma.inboundInvoice.create({
      data: {
        companyId,
        channel,
        providerId: providerId ?? null,
        externalId,
        senderId: senderId ?? null,
        syntax: syntax ?? null,
        rawPayload,
        invoiceNumber: parsed.invoiceNumber ?? null,
        issueDate: parsed.issueDate ?? null,
        sellerName: parsed.sellerName ?? null,
        sellerTaxId: parsed.sellerTaxId ?? null,
        buyerTaxId: parsed.buyerTaxId ?? null,
        currency: parsed.currency ?? null,
        totalNet: parsed.totalNet ?? null,
        totalTax: parsed.totalTax ?? null,
        totalGross: parsed.totalGross ?? null,
        status,
      },
    });

    this.logger.log(`InboundInvoice: stored ${channel}:${externalId} id=${row.id} status=${status}`);
    return { kind: 'STORED', id: row.id };
  }

  /**
   * Paginated list of received invoices for a company (newest first).
   */
  async list(companyId: string, page = 1, pageSize = PAGE_SIZE) {
    const skip = Math.max(0, page - 1) * pageSize;
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.inboundInvoice.findMany({
        where: { companyId },
        orderBy: { receivedAt: 'desc' },
        skip,
        take: pageSize,
        select: {
          id: true,
          channel: true,
          providerId: true,
          externalId: true,
          senderId: true,
          syntax: true,
          invoiceNumber: true,
          issueDate: true,
          sellerName: true,
          sellerTaxId: true,
          buyerTaxId: true,
          currency: true,
          totalNet: true,
          totalTax: true,
          totalGross: true,
          status: true,
          receivedAt: true,
        },
      }),
      this.prisma.inboundInvoice.count({ where: { companyId } }),
    ]);

    return {
      invoices: rows,
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  /**
   * Get a single received invoice by id (verifies companyId ownership).
   * Returns rawPayload in the response for download.
   */
  async getOne(id: string, companyId: string) {
    const row = await this.prisma.inboundInvoice.findFirst({
      where: { id, companyId },
    });
    if (!row) throw new HttpException('Inbound invoice not found', HttpStatus.NOT_FOUND);
    return row;
  }

  /**
   * Accept or reject a received invoice (update status + emit ack seam).
   * The actual buyer-status transmission (Peppol Invoice Response, SdI esito) is
   * a TODO seam: emitBuyerStatus() below logs a todo until the channel is live.
   */
  async acceptOrReject(
    id: string,
    companyId: string,
    action: 'accept' | 'reject',
    reason?: string,
  ) {
    const row = await this.prisma.inboundInvoice.findFirst({ where: { id, companyId } });
    if (!row) throw new HttpException('Inbound invoice not found', HttpStatus.NOT_FOUND);
    if (row.status === 'ACCEPTED' || row.status === 'REJECTED') {
      throw new HttpException(`Invoice already ${row.status.toLowerCase()}`, HttpStatus.CONFLICT);
    }

    const newStatus: InboundInvoiceStatus = action === 'accept' ? 'ACCEPTED' : 'REJECTED';
    const updated = await this.prisma.inboundInvoice.update({
      where: { id },
      data: { status: newStatus },
    });

    // Seam: emit buyer-side ack (Peppol Invoice Response AB/RE, SdI esito EC01/EC02, PDP approbation)
    this.emitBuyerStatusSeam(row.channel, row.externalId, action, reason);

    this.logger.log(`InboundInvoice: ${action} id=${id} channel=${row.channel} externalId=${row.externalId}`);
    return { id: updated.id, status: updated.status, channel: updated.channel, externalId: updated.externalId };
  }

  /**
   * Seam for buyer-status transmission. Logs a TODO until each channel is live.
   * Per COMPLIANCE_TODO.md §5: SdI esito EC01/EC02 + Peppol Invoice Response are
   * structurally implemented in sendStatus but deferred to live credentials.
   */
  private emitBuyerStatusSeam(channel: string, externalId: string, action: 'accept' | 'reject', reason?: string): void {
    const status = action === 'accept' ? 'ACCEPTED' : 'REJECTED';
    this.logger.log(
      `[TODO] emit buyer ack for ${channel}:${externalId} → ${status}${reason ? ` (reason: ${reason})` : ''}`,
    );
    // TODO (when live):
    //   PDP   → POST /lifecycle_events with fr:205 (approved) or fr:210 (refused)
    //   SdI   → esito EC01 (accept) or EC02 (reject) via SdiClient.sendStatus()
    //   Peppol→ Invoice Response AB (accept) or RE (reject) via PeppolClient.sendStatus()
    //   KSeF  → no buyer ack required by authority
  }
}
