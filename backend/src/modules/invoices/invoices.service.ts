import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CreateInvoiceDto,
  CreateInvoiceFromQuoteDto,
  EditInvoicesDto,
} from '@/modules/invoices/dto/invoices.dto';
import { ExportFormat } from '@/compliance/providers/format/invoice-artifact-port';

import { NumberingService } from '@/utils/numbering';
import { WebhookDispatcherService } from '../webhooks/webhook-dispatcher.service';
import { Prisma, WebhookEvent } from '../../../prisma/generated/prisma/client';
import { logger } from '@/logger/logger.service';
import prisma from '@/prisma/prisma.service';
import { ComplianceService } from '@/compliance/operations/compliance-service';
import { FormatValidationError } from '@/compliance/execution/types';
import { assembleLifecycle, phaseContextFromPlan } from '@/compliance/lifecycle/assembler';
import { LifecycleRuntime } from '@/compliance/lifecycle/runtime';
import type { CompliancePlan } from '@/compliance/engine/compliance-engine';
import type { ComplianceStatus } from '@/compliance/lifecycle/state-machine';
import {
  defaultTransmissionRegistry,
  TransmissionProviderRegistry,
} from '@/compliance/providers/transmission/registry';
import { describeFlow } from '@/compliance/lifecycle/flow-descriptor';
import { ComplianceQueueDispatcher } from '@/compliance/nest/queue/compliance-queue.dispatcher';
import { clampDiscountRate, toMinor } from '@/utils/financial';
import type { SupplyType, DocumentKind } from '@/compliance/types';
import { enrichWithPaymentMethod, enrichWithPaymentMethods } from '@/utils/enrich-payment-methods';
import {
  buildComplianceContext,
  deriveComplianceError,
  deriveInvoiceActions,
  invoiceItemData,
  resolveBuyerCountryOrThrow,
  resolveTax,
  toComplianceLines,
} from './invoices.helpers';
import { InvoiceRenderingService } from '@/modules/invoice-rendering/invoice-rendering.service';

@Injectable()
export class InvoicesService {
  constructor(
    private readonly webhookDispatcher: WebhookDispatcherService,
    private readonly numberingService: NumberingService,
    private readonly complianceService: ComplianceService,
    private readonly rendering: InvoiceRenderingService,
    // QUEUE_IMPL_PLAN.md §5.6 — credentialed registry (F-3), used ONLY to look up the primary
    // channel's feedback model (never to transmit directly from here); ComplianceQueueDispatcher is
    // the single enqueue point for the async ("real" event-sourced) send path.
    private readonly transmissionRegistry: TransmissionProviderRegistry,
    private readonly complianceQueue: ComplianceQueueDispatcher,
  ) {}

  /**
   * M-2: report a compliance side-effect failure from inside a non-blocking catch block (an
   * invoice/correction/deposit/etc. was already committed and this call site deliberately does not
   * rethrow). `ComplianceService.recordWiringFailure` is itself defensive and documented to never
   * throw, but this wrapper is a second guard so a misbehaving or test-mocked ComplianceService can
   * never escape the non-blocking contract of the call site that invokes it.
   */
  private async reportComplianceWiringFailure(
    complianceDocId: string,
    operation: string,
    error: unknown,
  ): Promise<void> {
    try {
      await this.complianceService.recordWiringFailure(complianceDocId, operation, error);
    } catch (reportingError) {
      logger.error('recordWiringFailure itself threw — swallowed to preserve the non-blocking contract', {
        category: 'invoice',
        details: { complianceDocId, operation, error: String(reportingError) },
      });
    }
  }

  async getInvoice(companyId: string, id: string) {
    const invoice = await prisma.invoice.findFirst({
      where: { id, companyId },
      include: {
        items: true,
        client: { include: { partyIdentifiers: true } },
        company: { include: { partyIdentifiers: true } },
        payments: { select: { totalPaid: true } },
        correctedBy: {
          select: {
            id: true,
            rawNumber: true,
            number: true,
            kind: true,
            totalTTC: true,
            currency: true,
            status: true,
          },
          where: { isActive: true },
        },
        complianceDocuments: {
          select: {
            id: true,
            status: true,
            number: true,
            plan: true,
            immutableHash: true,
            events: {
              select: { type: true, at: true, actor: true, detail: true },
              orderBy: { at: 'asc' as const },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');

    return enrichWithPaymentMethod(invoice);
  }

  async getInvoices(companyId: string, page: string) {
    const pageNumber = parseInt(page, 10) || 1;
    const pageSize = 10;
    const skip = (pageNumber - 1) * pageSize;

    const invoices = await prisma.invoice.findMany({
      skip,
      take: pageSize,
      where: {
        companyId,
        isActive: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        items: true,
        client: { include: { partyIdentifiers: true } },
        company: { include: { partyIdentifiers: true } },
        payments: { select: { totalPaid: true } },
        correctedBy: {
          select: {
            id: true,
            rawNumber: true,
            number: true,
            kind: true,
            totalTTC: true,
            currency: true,
            status: true,
          },
          where: { isActive: true },
        },
        complianceDocuments: {
          select: { id: true, status: true, plan: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    const totalInvoices = await prisma.invoice.count({ where: { companyId } });

    // Attach payment method object when available so frontend can consume invoice.paymentMethod as an object
    const invoicesWithPM = await enrichWithPaymentMethods(invoices);

    const mapped = invoicesWithPM.map((inv: any) => {
      const doc = inv.complianceDocuments?.[0];
      // `actions` mirrors GET /invoices/:id/available-actions (same helper) so the
      // list UI can rely on backend-driven flags without an N+1 per-row fetch.
      if (!doc?.plan) return { ...inv, actions: deriveInvoiceActions(inv, null) };
      const plan = doc.plan as unknown as CompliancePlan;
      const flow = describeFlow(plan, doc.status as ComplianceStatus);
      return {
        ...inv,
        actions: deriveInvoiceActions(inv, new Set(flow.manualActions), plan.lifecycle?.correctionModel),
        complianceDocuments: [
          {
            id: doc.id,
            status: doc.status,
            flow: {
              channelClass: flow.channelClass,
              sendLabelKey: flow.sendLabelKey,
              awaiting: flow.awaiting,
              pipeline: flow.pipeline,
              manualActions: flow.manualActions,
            },
          },
        ],
      };
    });

    return { pageCount: Math.ceil(totalInvoices / pageSize), invoices: mapped };
  }

  async getInvoicesTable(
    companyId: string,
    filters: {
      clientId?: string;
      year?: string;
      month?: string;
      sort?: 'asc' | 'desc';
    },
  ) {
    const where: Record<string, any> = { companyId, isActive: true };

    if (filters.clientId) {
      where.clientId = filters.clientId;
    }

    const year = parseInt(filters.year ?? '', 10);
    if (!isNaN(year)) {
      const month = parseInt(filters.month ?? '', 10);
      if (!isNaN(month) && month >= 1 && month <= 12) {
        where.createdAt = {
          gte: new Date(year, month - 1, 1),
          lt: new Date(year, month, 1),
        };
      } else {
        where.createdAt = {
          gte: new Date(year, 0, 1),
          lt: new Date(year + 1, 0, 1),
        };
      }
    }

    const sort = filters.sort === 'asc' ? 'asc' : 'desc';

    const invoices = await prisma.invoice.findMany({
      where,
      orderBy: {
        createdAt: sort,
      },
      include: {
        items: true,
        client: true,
        company: true,
        payments: { select: { totalPaid: true } },
      },
    });

    return enrichWithPaymentMethods(invoices);
  }

  async searchInvoices(companyId: string, query: string) {
    if (query === '') {
      return this.getInvoices(companyId, '1'); // Return first page if query is empty
    }

    const results = await prisma.invoice.findMany({
      where: {
        companyId,
        OR: [{ client: { name: { contains: query } } }, { items: { some: { name: { contains: query } } } }],
      },
      include: {
        items: true,
        client: { include: { partyIdentifiers: true } },
        company: { include: { partyIdentifiers: true } },
        payments: { select: { id: true, totalPaid: true } },
        correctedBy: {
          select: {
            id: true,
            rawNumber: true,
            number: true,
            kind: true,
            totalTTC: true,
            currency: true,
            status: true,
          },
          where: { isActive: true },
        },
      },
    });

    return enrichWithPaymentMethods(results);
  }

  async createInvoice(companyId: string, body: CreateInvoiceDto) {
    const { items, ...data } = body;

    const company = await prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      include: { partyIdentifiers: true },
    });

    const client = await prisma.client.findFirst({
      where: { id: body.clientId, companyId },
      include: { partyIdentifiers: true },
    });
    if (!client) {
      logger.error('Client not found', { category: 'invoice' });
      throw new BadRequestException('Client not found');
    }

    const discountRate = clampDiscountRate(body.discountRate);
    const taxResult = resolveTax(company, client, {
      currency: body.currency || client.currency || company.currency,
      discountRate,
      items,
    });

    if (taxResult.warnings.length > 0) {
      logger.warn('Tax resolution warnings', {
        category: 'invoice',
        details: { warnings: taxResult.warnings },
      });
    }

    const invoice = await prisma.invoice.create({
      data: {
        ...data,
        status: 'DRAFT',
        recurringInvoiceId: body.recurringInvoiceId,
        recurringPeriodKey: body.recurringPeriodKey ?? null,
        paymentMethod: body.paymentMethod,
        paymentDetails: body.paymentDetails,
        paymentMethodId: body.paymentMethodId,
        currency: body.currency || client.currency || company.currency,
        companyId: company.id,
        discountRate,
        totalHT: taxResult.totalHT,
        totalHTMinor: taxResult.totalsMinor.netMinor,
        totalVAT: taxResult.totalVAT,
        totalVATMinor: taxResult.totalsMinor.taxMinor,
        totalTTC: taxResult.totalTTC,
        totalTTCMinor: taxResult.totalsMinor.grossMinor,
        items: {
          create: items.map((item, i) => ({
            ...invoiceItemData(
              item,
              body.currency || client.currency || company.currency,
              taxResult.itemVatRates[i],
            ),
            name: item.name ?? item.description,
            quoteItemId: item.quoteItemId,
          })),
        },
        dueDate: data.dueDate ? new Date(data.dueDate) : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      },
      include: {
        items: true,
        client: { include: { partyIdentifiers: true } },
        company: { include: { partyIdentifiers: true } },
      },
    });

    logger.info('Invoice created', {
      category: 'invoice',
      details: { invoiceId: invoice.id, clientId: client.id },
    });

    // Wire ComplianceService: create a draft compliance document linked to this invoice
    try {
      const complianceCtx = buildComplianceContext(company, client, {
        lines: toComplianceLines(items, body.currency || client.currency || company.currency),
        issueDate: new Date(),
        currency: body.currency || client.currency || company.currency,
        externalRef: invoice.id,
      });
      await this.complianceService.createDraft(complianceCtx, 'INVOICE', invoice.id);
    } catch (error) {
      // M-2: createDraft itself failed — there is no ComplianceDocument row yet to attach a
      // WIRING_FAILED event to. The invoice having NO compliance document at all is itself the
      // visible signal; upgraded warn → error (a genuine, unrecorded failure, not a shrug).
      logger.error(
        'ComplianceService.createDraft failed — invoice has no compliance document (non-blocking)',
        {
          category: 'invoice',
          details: { invoiceId: invoice.id, operation: 'createInvoice.createDraft', error: String(error) },
        },
      );
    }

    try {
      await this.webhookDispatcher.dispatch(WebhookEvent.INVOICE_CREATED, {
        invoice,
        client,
        company,
      });
    } catch (error) {
      logger.error('Failed to dispatch INVOICE_CREATED webhook', { category: 'invoice', details: { error } });
    }

    return invoice;
  }

  async issueInvoice(companyId: string, id: string) {
    const invoice = await prisma.invoice.findFirst({
      where: { id, companyId },
      include: {
        items: true,
        client: { include: { partyIdentifiers: true } },
        company: { include: { partyIdentifiers: true } },
      },
    });

    if (!invoice) {
      logger.error('Invoice not found', { category: 'invoice' });
      throw new NotFoundException('Invoice not found');
    }

    if (invoice.status !== 'DRAFT') {
      logger.error('Only DRAFT invoices can be issued', {
        category: 'invoice',
        details: { id, status: invoice.status },
      });
      throw new BadRequestException('Only DRAFT invoices can be issued');
    }

    if (invoice.number !== null) {
      logger.error('Invoice already has a number', { category: 'invoice', details: { id } });
      throw new BadRequestException('Invoice already has a number');
    }

    // Hard-block issuance when the buyer's country cannot be resolved (product decision — see
    // invoices.helpers.ts:resolveBuyerCountryOrThrow). VAT totals are computed and STORED at DRAFT
    // creation, so a draft created for a country-less client stores totalVAT = 0; if the client's
    // country is set AFTER the draft was created, that stored 0 would go stale. Re-resolve from the
    // CURRENT client and re-run tax computation here (not just re-check presence) so issuance always
    // persists fresh, correct totals — never the draft-time snapshot.
    resolveBuyerCountryOrThrow(invoice.client);

    const taxResult = resolveTax(invoice.company, invoice.client, {
      currency: invoice.currency,
      discountRate: invoice.discountRate,
      items: invoice.items.map((item) => ({
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        // Re-hint from the user's ORIGINAL request (`requestedVatRate`), not the stored/resolved
        // `vatRate`. The engine re-applies that hint under the now-resolved country/role/supply-type,
        // so a country-less draft's real hint (e.g. 20) yields correct domestic VAT at issue — no
        // under-charge — while a deliberate 0% hint is preserved (no over-charge), and exports/
        // reverse-charge still resolve to 0% regardless. `??` (not `||`) so a genuine stored 0 hint
        // is honored. Legacy rows (requestedVatRate null) fall back to country-derivation.
        vatRate: item.requestedVatRate ?? undefined,
        type: item.type,
      })),
    });

    if (taxResult.warnings.length > 0) {
      logger.warn('Tax resolution warnings at issuance', {
        category: 'invoice',
        details: { invoiceId: id, warnings: taxResult.warnings },
      });
    }

    const issueDate = new Date();
    const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const { counter, rawNumber } = await this.numberingService.nextNumber(
        tx,
        invoice.companyId,
        'invoice',
        issueDate,
      );

      return tx.invoice.update({
        where: { id },
        data: {
          number: counter,
          rawNumber,
          issuedAt: issueDate,
          status: 'ISSUED',
          totalHT: taxResult.totalHT,
          totalHTMinor: taxResult.totalsMinor.netMinor,
          totalVAT: taxResult.totalVAT,
          totalVATMinor: taxResult.totalsMinor.taxMinor,
          totalTTC: taxResult.totalTTC,
          totalTTCMinor: taxResult.totalsMinor.grossMinor,
          items: {
            update: invoice.items.map((item, i) => ({
              where: { id: item.id },
              data: { vatRate: taxResult.itemVatRates[i] },
            })),
          },
        },
        include: {
          items: true,
          client: { include: { partyIdentifiers: true } },
          company: { include: { partyIdentifiers: true } },
        },
      });
    });

    // Wire ComplianceService: issue the compliance document linked to this invoice
    let issueDocId: string | undefined;
    try {
      const complianceDoc = await prisma.complianceDocument.findFirst({
        where: { invoiceId: id },
        orderBy: { createdAt: 'desc' },
      });
      if (complianceDoc) {
        issueDocId = complianceDoc.id;
        // The compliance draft was snapshotted at DRAFT creation (createInvoice) and may have gone
        // stale — e.g. the client had no country yet, so buildComplianceContext froze buyer country
        // to its 'FR' fallback. `invoice` (fetched above, still pre-issuance) carries items/client/
        // company as they are NOW; rebuild the ctx from it and push it into the still-DRAFT
        // compliance document (editDraft is only permitted pre-issue) so `issue()` resolves the
        // tax plan and hash-chains the CURRENT context, not the draft-time one.
        const freshCtx = buildComplianceContext(invoice.company, invoice.client, {
          lines: toComplianceLines(invoice.items, invoice.currency),
          issueDate,
          currency: invoice.currency,
          externalRef: invoice.id,
        });
        await this.complianceService.editDraft(complianceDoc.id, freshCtx);
        await this.complianceService.issue(complianceDoc.id);
      } else {
        logger.warn('No compliance document found for issued invoice', {
          category: 'invoice',
          details: { invoiceId: id },
        });
      }
    } catch (error) {
      if (issueDocId) {
        await this.reportComplianceWiringFailure(issueDocId, 'issueInvoice', error);
      } else {
        logger.error(
          'ComplianceService wiring failed for issued invoice — no compliance document found (non-blocking)',
          {
            category: 'invoice',
            details: { invoiceId: id, operation: 'issueInvoice', error: String(error) },
          },
        );
      }
    }

    logger.info('Invoice issued', {
      category: 'invoice',
      details: { invoiceId: id, number: updated.rawNumber },
    });

    try {
      await this.webhookDispatcher.dispatch(WebhookEvent.INVOICE_UPDATED, {
        invoice: updated,
        client: updated.client,
        company: updated.company,
      });
    } catch (error) {
      logger.error('Failed to dispatch INVOICE_UPDATED webhook after issue', {
        category: 'invoice',
        details: { error },
      });
    }

    return updated;
  }

  async correctInvoice(companyId: string, id: string, reason?: string) {
    const invoice = await prisma.invoice.findFirst({
      where: { id, companyId },
      include: {
        items: true,
        client: { include: { partyIdentifiers: true } },
        company: { include: { partyIdentifiers: true } },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status === 'DRAFT') throw new BadRequestException('Only issued invoices can be corrected');

    try {
      // Resolve the correction model from the compliance plan (consumes the engine, not a if-pays)
      const complianceDoc = await prisma.complianceDocument.findFirst({
        where: { invoiceId: id },
        orderBy: { createdAt: 'desc' },
      });
      if (!complianceDoc) {
        throw new BadRequestException('No compliance document found for this invoice');
      }

      const storedPlan = complianceDoc.plan as any;
      const correctionModel: string = storedPlan?.lifecycle?.correctionModel ?? 'CREDIT_NOTE';

      // Determine the correction kind and compute items/totals
      let correctionKind: DocumentKind;
      let correctionItems: any[];
      let totalHT: number;
      let totalVAT: number;
      let totalTTC: number;

      const copyItems = (negate: boolean) =>
        invoice.items.map((item, i) => ({
          description: item.description,
          quantity: negate ? -item.quantity : item.quantity,
          unitPrice: item.unitPrice,
          unitPriceMinor:
            item.unitPriceMinor != null ? (negate ? -item.unitPriceMinor : item.unitPriceMinor) : null,
          vatRate: item.vatRate,
          type: item.type,
          order: i,
          discountRate: item.discountRate,
          discountAmount: negate ? null : item.discountAmount,
          discountAmountMinor: negate ? null : item.discountAmountMinor,
          chargeAmount: negate ? null : item.chargeAmount,
          chargeAmountMinor: negate ? null : item.chargeAmountMinor,
          chargeDescription: negate ? null : item.chargeDescription,
          unitOfMeasure: item.unitOfMeasure,
        }));

      if (correctionModel === 'CANCEL_AND_REPLACE') {
        correctionKind = 'INVOICE';
        correctionItems = copyItems(false);
        totalHT = invoice.totalHT;
        totalVAT = invoice.totalVAT;
        totalTTC = invoice.totalTTC;
      } else if (correctionModel === 'CORRECTIVE_INVOICE') {
        correctionKind = 'CORRECTIVE_INVOICE';
        correctionItems = copyItems(false);
        totalHT = invoice.totalHT;
        totalVAT = invoice.totalVAT;
        totalTTC = invoice.totalTTC;
      } else {
        correctionKind = 'CREDIT_NOTE';
        correctionItems = copyItems(true);
        totalHT = -invoice.totalHT;
        totalVAT = -invoice.totalVAT;
        totalTTC = -invoice.totalTTC;
      }

      const totalHTMinor =
        correctionModel === 'CREDIT_NOTE'
          ? invoice.totalHTMinor != null
            ? -invoice.totalHTMinor
            : null
          : invoice.totalHTMinor;
      const totalVATMinor =
        correctionModel === 'CREDIT_NOTE'
          ? invoice.totalVATMinor != null
            ? -invoice.totalVATMinor
            : null
          : invoice.totalVATMinor;
      const totalTTCMinor =
        correctionModel === 'CREDIT_NOTE'
          ? invoice.totalTTCMinor != null
            ? -invoice.totalTTCMinor
            : null
          : invoice.totalTTCMinor;

      // Create the correction invoice as ISSUED (numbered — it's a legal document)
      const issueDate = new Date();
      const correctionInvoice = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const { counter, rawNumber } = await this.numberingService.nextNumber(
          tx,
          invoice.companyId,
          'invoice',
          issueDate,
        );

        return tx.invoice.create({
          data: {
            kind: correctionKind as any,
            correctsInvoiceId: id,
            clientId: invoice.clientId,
            companyId: invoice.companyId,
            currency: invoice.currency,
            number: counter,
            rawNumber,
            issuedAt: issueDate,
            status: 'ISSUED',
            dueDate: invoice.dueDate,
            notes: reason || `Correction of ${invoice.rawNumber || invoice.number}`,
            discountRate: invoice.discountRate,
            totalHT,
            totalVAT,
            totalTTC,
            totalHTMinor,
            totalVATMinor,
            totalTTCMinor,
            items: {
              create: correctionItems,
            },
          },
          include: {
            items: true,
            client: { include: { partyIdentifiers: true } },
            company: { include: { partyIdentifiers: true } },
          },
        });
      });

      // Update original invoice status → CORRECTED
      await prisma.invoice.update({
        where: { id },
        data: { status: 'CORRECTED' },
      });

      // Wire ComplianceService for the correction (non-blocking)
      let correctionDocId: string | undefined;
      try {
        const complianceCtx = buildComplianceContext(invoice.company, invoice.client, {
          lines: toComplianceLines(correctionInvoice.items, invoice.currency),
          issueDate: new Date(),
          currency: invoice.currency,
          // M-4: must point at the CORRECTION's own row, not the original's — the format
          // providers (e.g. FaVatFormatProvider) resolve `ctx.externalRef` back into an
          // invoiceId to render FROM (InvoiceRenderingService.fetchRenderData). Pointing this at
          // `invoice.id` (as before) silently re-rendered the ORIGINAL invoice as a plain FA(2)/
          // FA(3) "VAT" document instead of the correction's own data (correction items/number,
          // and — for PL — the KOR block referencing the original). Mirrors the correct pattern
          // already used by cancelAndReplaceInvoice() (`externalRef: replacement.id`).
          externalRef: correctionInvoice.id,
        });
        const correctionDoc = await this.complianceService.createDraft(
          complianceCtx,
          correctionKind as any,
          correctionInvoice.id,
          // M-4: link the new ComplianceDocument to the original's, so a national builder (PL's
          // faktura korygująca) can look up the original's KSeF number and the runtime can trace
          // corrections back to what they correct (ComplianceDocumentRecord.correctsId).
          complianceDoc.id,
        );
        correctionDocId = correctionDoc.id;
        await this.complianceService.issue(correctionDoc.id);
      } catch (error) {
        // M-2: prefer the correction's OWN document (created but stuck at DRAFT because issue()
        // failed) — fall back to the ORIGINAL's document when createDraft() itself never produced
        // a correction document to attach the failure to.
        await this.reportComplianceWiringFailure(
          correctionDocId ?? complianceDoc.id,
          'correctInvoice',
          error,
        );
      }

      logger.info('Invoice corrected', {
        category: 'invoice',
        details: { invoiceId: id, correctionInvoiceId: correctionInvoice.id, correctionKind },
      });
      return {
        message: 'Correction issued',
        correctionInvoiceId: correctionInvoice.id,
        correctionNumber: correctionInvoice.rawNumber,
        correctionKind,
      };
    } catch (error) {
      logger.error('Failed to correct invoice', { category: 'invoice', details: { error: String(error) } });
      throw new BadRequestException(`Failed to correct invoice: ${(error as Error).message}`);
    }
  }

  async cancelInvoice(companyId: string, id: string, reason?: string) {
    const invoice = await prisma.invoice.findFirst({ where: { id, companyId } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status === 'DRAFT') throw new BadRequestException('Only issued invoices can be cancelled');

    try {
      const complianceDoc = await prisma.complianceDocument.findFirst({
        where: { invoiceId: id },
        orderBy: { createdAt: 'desc' },
      });
      if (!complianceDoc) {
        throw new BadRequestException('No compliance document found for this invoice');
      }
      const result = await this.complianceService.cancel(complianceDoc.id, { reason });
      if (!result.accepted) {
        return { message: 'Cancellation rejected', reason: result.reason };
      }

      // Reflect compliance status on the invoice (III.1 — single vocabulary)
      await prisma.invoice.update({
        where: { id },
        data: { status: 'CANCELLED' },
      });

      logger.info('Invoice cancelled', { category: 'invoice', details: { invoiceId: id } });
      return { message: 'Invoice cancelled', accepted: true };
    } catch (error) {
      logger.error('Failed to cancel invoice', { category: 'invoice', details: { error: String(error) } });
      throw new BadRequestException(`Failed to cancel invoice: ${(error as Error).message}`);
    }
  }

  async cancelAndReplaceInvoice(companyId: string, id: string, reason?: string) {
    const invoice = await prisma.invoice.findFirst({
      where: { id, companyId },
      include: {
        items: true,
        client: { include: { partyIdentifiers: true } },
        company: { include: { partyIdentifiers: true } },
      },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status === 'DRAFT') throw new BadRequestException('Only issued invoices can be cancelled');

    try {
      const complianceDoc = await prisma.complianceDocument.findFirst({
        where: { invoiceId: id },
        orderBy: { createdAt: 'desc' },
      });
      if (!complianceDoc) {
        throw new BadRequestException('No compliance document found for this invoice');
      }

      // Verify correctionModel is CANCEL_AND_REPLACE
      const storedPlan = complianceDoc.plan as any;
      const correctionModel = storedPlan?.lifecycle?.correctionModel;
      if (correctionModel !== 'CANCEL_AND_REPLACE') {
        throw new BadRequestException(
          'Cancel-and-replace is not available for this country. Use correct instead.',
        );
      }

      // Cancel the original via ComplianceService (policy-gated)
      const cancelResult = await this.complianceService.cancel(complianceDoc.id, { reason });
      if (!cancelResult.accepted) {
        return { message: 'Cancellation rejected', reason: cancelResult.reason };
      }

      await prisma.invoice.update({
        where: { id },
        data: { status: 'CANCELLED' },
      });

      // Create a replacement invoice (same content, numbered)
      const issueDate = new Date();
      const replacement = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const { counter, rawNumber } = await this.numberingService.nextNumber(
          tx,
          invoice.companyId,
          'invoice',
          issueDate,
        );

        return tx.invoice.create({
          data: {
            kind: 'INVOICE' as any,
            correctsInvoiceId: id,
            clientId: invoice.clientId,
            companyId: invoice.companyId,
            currency: invoice.currency,
            number: counter,
            rawNumber,
            issuedAt: issueDate,
            status: 'ISSUED',
            dueDate: invoice.dueDate,
            notes: reason || `Replacement of ${invoice.rawNumber || invoice.number}`,
            discountRate: invoice.discountRate,
            totalHT: invoice.totalHT,
            totalVAT: invoice.totalVAT,
            totalTTC: invoice.totalTTC,
            totalHTMinor: invoice.totalHTMinor,
            totalVATMinor: invoice.totalVATMinor,
            totalTTCMinor: invoice.totalTTCMinor,
            items: {
              create: invoice.items.map((item, i) => ({
                name: item.name,
                description: item.description,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                unitPriceMinor: item.unitPriceMinor,
                vatRate: item.vatRate,
                type: item.type,
                order: i,
                discountRate: item.discountRate,
                discountAmount: item.discountAmount,
                discountAmountMinor: item.discountAmountMinor,
                chargeAmount: item.chargeAmount,
                chargeAmountMinor: item.chargeAmountMinor,
                chargeDescription: item.chargeDescription,
                unitOfMeasure: item.unitOfMeasure,
              })),
            },
          },
          include: {
            items: true,
            client: { include: { partyIdentifiers: true } },
            company: { include: { partyIdentifiers: true } },
          },
        });
      });

      // Wire ComplianceService for the replacement (non-blocking)
      let replacementDocId: string | undefined;
      try {
        // NOTE: unlike the other flows, replacement lines prefer the stored
        // unitPriceMinor over a fresh toMinor() conversion — keep inline.
        const complianceCtx = buildComplianceContext(invoice.company, invoice.client, {
          lines: invoice.items.map((item) => ({
            id: `item-${item.order ?? 0}`,
            description: (item.description ?? '') as string,
            quantity: item.quantity,
            unitNetMinor: item.unitPriceMinor ?? toMinor(item.unitPrice, invoice.currency),
            supplyType: (item.type === 'PRODUCT' ? 'GOODS' : 'SERVICES') as SupplyType,
          })),
          issueDate,
          currency: invoice.currency,
          externalRef: replacement.id,
        });
        const replacementDoc = await this.complianceService.createDraft(
          complianceCtx,
          'INVOICE',
          replacement.id,
        );
        replacementDocId = replacementDoc.id;
        await this.complianceService.issue(replacementDoc.id);
      } catch (error) {
        // M-2: prefer the replacement's OWN document — fall back to the original's (already
        // cancelled at this point) when createDraft() never produced a replacement document.
        await this.reportComplianceWiringFailure(
          replacementDocId ?? complianceDoc.id,
          'cancelAndReplaceInvoice',
          error,
        );
      }

      logger.info('Invoice cancelled and replaced', {
        category: 'invoice',
        details: { invoiceId: id, replacementId: replacement.id },
      });
      return {
        message: 'Invoice cancelled and replaced',
        replacementId: replacement.id,
        replacementNumber: replacement.rawNumber,
      };
    } catch (error) {
      logger.error('Failed to cancel and replace invoice', {
        category: 'invoice',
        details: { error: String(error) },
      });
      throw new BadRequestException(`Failed to cancel and replace invoice: ${(error as Error).message}`);
    }
  }

  async editInvoice(companyId: string, body: EditInvoicesDto) {
    const { items, id, discountRate, ...data } = body;

    if (!id) {
      logger.error('Invoice ID is required for editing', { category: 'invoice' });
      throw new BadRequestException('Invoice ID is required for editing');
    }

    const company = await prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      include: { partyIdentifiers: true },
    });

    const client = await prisma.client.findFirst({
      where: { id: data.clientId, companyId },
      include: { partyIdentifiers: true },
    });
    if (!client) {
      logger.error('Client not found', { category: 'invoice' });
      throw new BadRequestException('Client not found');
    }

    const existingInvoice = await prisma.invoice.findFirst({
      where: { id, companyId },
      include: { items: true },
    });

    if (!existingInvoice) {
      logger.error('Invoice not found', { category: 'invoice' });
      throw new NotFoundException('Invoice not found');
    }

    if (existingInvoice.status !== 'DRAFT') {
      // Check immutableAfter from the compliance plan — NEVER means always editable
      let immutableAfter = 'ISSUE'; // default
      try {
        const complianceDoc = await prisma.complianceDocument.findFirst({
          where: { invoiceId: id },
          orderBy: { createdAt: 'desc' },
        });
        if (complianceDoc?.plan) {
          immutableAfter = (complianceDoc.plan as any)?.lifecycle?.immutableAfter ?? 'ISSUE';
        }
      } catch {
        // non-blocking: default to ISSUE
      }

      if (immutableAfter !== 'NEVER') {
        logger.error('Only DRAFT invoices can be edited', {
          category: 'invoice',
          details: { id, status: existingInvoice.status },
        });
        throw new BadRequestException(
          'Only DRAFT invoices can be edited. Issued documents require a correction.',
        );
      }

      // immutableAfter === 'NEVER' (US / FALLBACK profiles): this invoice is already ISSUED but
      // stays editable. Re-editing it recomputes and persists tax below (resolveTax), so hard-block
      // the same way issueInvoice does — a client whose country was cleared after issuance must not
      // silently recompute this already-issued invoice to 0% VAT.
      resolveBuyerCountryOrThrow(client);
    }

    const existingItemIds = existingInvoice.items.map((i) => i.id);
    const incomingItemIds = items.filter((i) => i.id).map((i) => i.id!);

    const itemIdsToDelete = existingItemIds.filter((id) => !incomingItemIds.includes(id));

    const normalizedDiscountRate = clampDiscountRate(discountRate ?? existingInvoice.discountRate);
    const taxResult = resolveTax(company, client, {
      currency: body.currency || client.currency || company.currency,
      discountRate: normalizedDiscountRate,
      items,
    });

    if (taxResult.warnings.length > 0) {
      logger.warn('Tax resolution warnings', {
        category: 'invoice',
        details: { warnings: taxResult.warnings },
      });
    }

    const updateInvoice = await prisma.invoice.update({
      where: { id },
      data: {
        recurringInvoiceId: data.recurringInvoiceId,
        paymentMethod: data.paymentMethod || existingInvoice.paymentMethod,
        paymentMethodId: (data as any).paymentMethodId || existingInvoice.paymentMethodId,
        paymentDetails: data.paymentDetails || existingInvoice.paymentDetails,
        quoteId: data.quoteId || existingInvoice.quoteId,
        clientId: data.clientId || existingInvoice.clientId,
        notes: data.notes,
        currency: body.currency || client.currency || company.currency,
        dueDate: data.dueDate ? new Date(data.dueDate) : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        discountRate: normalizedDiscountRate,
        totalHT: taxResult.totalHT,
        totalHTMinor: taxResult.totalsMinor.netMinor,
        totalVAT: taxResult.totalVAT,
        totalVATMinor: taxResult.totalsMinor.taxMinor,
        totalTTC: taxResult.totalTTC,
        totalTTCMinor: taxResult.totalsMinor.grossMinor,
        items: {
          deleteMany: {
            id: { in: itemIdsToDelete },
          },
          updateMany: items
            .map((i, originalIdx) => ({ i, originalIdx }))
            .filter(({ i }) => i.id)
            .map(({ i, originalIdx }) => ({
              where: { id: i.id! },
              data: {
                ...invoiceItemData(
                  i,
                  body.currency || client.currency || company.currency,
                  taxResult.itemVatRates[originalIdx],
                ),
                name: i.name,
              },
            })),
          create: items
            .map((i, originalIdx) => ({ i, originalIdx }))
            .filter(({ i }) => !i.id)
            .map(({ i, originalIdx }) => ({
              ...invoiceItemData(
                i,
                body.currency || client.currency || company.currency,
                taxResult.itemVatRates[originalIdx],
              ),
              name: i.name ?? i.description,
            })),
        },
      },
      include: {
        items: true,
        client: { include: { partyIdentifiers: true } },
        company: { include: { partyIdentifiers: true } },
      },
    });

    // Audit: record EDIT event
    let editedDocId: string | undefined;
    try {
      const complianceDoc = await prisma.complianceDocument.findFirst({
        where: { invoiceId: id },
        orderBy: { createdAt: 'desc' },
      });
      if (complianceDoc) {
        editedDocId = complianceDoc.id;
        await this.complianceService.recordAuditEvent(complianceDoc.id, 'EDITED', `draft edited`);
      }
    } catch (error) {
      if (editedDocId) {
        await this.reportComplianceWiringFailure(editedDocId, 'recordAuditEvent(EDITED)', error);
      } else {
        logger.error(
          'ComplianceService.recordAuditEvent(EDITED) failed — no compliance document found (non-blocking)',
          {
            category: 'invoice',
            details: { invoiceId: id, error: String(error) },
          },
        );
      }
    }

    logger.info('Invoice updated', { category: 'invoice', details: { invoiceId: updateInvoice.id } });

    try {
      await this.webhookDispatcher.dispatch(WebhookEvent.INVOICE_UPDATED, {
        invoice: updateInvoice,
        client: updateInvoice.client,
        company: updateInvoice.company,
      });
    } catch (error) {
      logger.error('Failed to dispatch INVOICE_UPDATED webhook', { category: 'invoice', details: { error } });
    }

    return updateInvoice;
  }

  async deleteInvoice(companyId: string, id: string) {
    const existingInvoice = await prisma.invoice.findFirst({
      where: { id, companyId },
      include: {
        items: true,
        client: { include: { partyIdentifiers: true } },
        company: { include: { partyIdentifiers: true } },
      },
    });

    if (!existingInvoice) {
      logger.error('Invoice not found', { category: 'invoice' });
      throw new NotFoundException('Invoice not found');
    }

    if (existingInvoice.status !== 'DRAFT') {
      logger.error('Only DRAFT invoices can be deleted', {
        category: 'invoice',
        details: { id, status: existingInvoice.status },
      });
      throw new BadRequestException(
        'Only DRAFT invoices can be deleted. Issued documents must be cancelled instead.',
      );
    }

    const deletedInvoice = await prisma.invoice.update({
      where: { id },
      data: { isActive: false },
    });

    // Audit: record DELETED event
    let deletedDocId: string | undefined;
    try {
      const complianceDoc = await prisma.complianceDocument.findFirst({
        where: { invoiceId: id },
        orderBy: { createdAt: 'desc' },
      });
      if (complianceDoc) {
        deletedDocId = complianceDoc.id;
        await this.complianceService.recordAuditEvent(complianceDoc.id, 'DELETED', `draft deleted (soft)`);
      }
    } catch (error) {
      if (deletedDocId) {
        await this.reportComplianceWiringFailure(deletedDocId, 'recordAuditEvent(DELETED)', error);
      } else {
        logger.error(
          'ComplianceService.recordAuditEvent(DELETED) failed — no compliance document found (non-blocking)',
          {
            category: 'invoice',
            details: { invoiceId: id, error: String(error) },
          },
        );
      }
    }

    logger.info('Invoice deleted', { category: 'invoice', details: { invoiceId: id } });

    try {
      await this.webhookDispatcher.dispatch(WebhookEvent.INVOICE_DELETED, {
        invoice: existingInvoice,
        client: existingInvoice.client,
        company: existingInvoice.company,
      });
    } catch (error) {
      logger.error('Failed to dispatch INVOICE_DELETED webhook', { category: 'invoice', details: { error } });
    }

    return deletedInvoice;
  }

  /** Tenancy guard: rendering delegates look up by id only, so assert ownership first. */
  private async assertInvoiceInCompany(companyId: string, id: string): Promise<void> {
    const invoice = await prisma.invoice.findFirst({
      where: { id, companyId },
      select: { id: true },
    });
    if (!invoice) {
      logger.error('Invoice not found', { category: 'invoice', details: { invoiceId: id } });
      throw new NotFoundException('Invoice not found');
    }
  }

  async getInvoicePdf(companyId: string, id: string): Promise<Uint8Array> {
    await this.assertInvoiceInCompany(companyId, id);
    return this.rendering.renderPdf(id);
  }

  async getInvoiceXMLFormat(companyId: string, id: string) {
    await this.assertInvoiceInCompany(companyId, id);
    return this.rendering.renderXml(id);
  }

  async getInvoicePDFFormat(
    companyId: string,
    invoiceId: string,
    format: '' | 'pdf' | ExportFormat,
  ): Promise<Uint8Array> {
    await this.assertInvoiceInCompany(companyId, invoiceId);
    return this.rendering.renderPdfFormat(invoiceId, format);
  }

  async createInvoiceFromQuote(companyId: string, body: CreateInvoiceFromQuoteDto) {
    const quote = await prisma.quote.findFirst({
      where: { id: body.quoteId, companyId },
      include: {
        items: true,
        client: { include: { partyIdentifiers: true } },
        company: { include: { partyIdentifiers: true } },
      },
    });

    if (!quote) {
      logger.error('Quote not found when creating invoice from quote', {
        category: 'invoice',
        details: { quoteId: body.quoteId },
      });
      throw new NotFoundException('Quote not found');
    }

    const invoicingStatus = await this.getQuoteInvoicingStatus(companyId, body.quoteId);

    if (invoicingStatus.remainingPercent <= 0) {
      logger.error('Quote has already been fully invoiced', {
        category: 'invoice',
        details: { quoteId: body.quoteId },
      });
      throw new BadRequestException('This quote has already been fully invoiced');
    }

    const quoteItemById = new Map<string, (typeof quote.items)[number]>(
      quote.items.map((item) => [item.id, item] as const),
    );
    const remainingByItemId = new Map<string, number>(
      invoicingStatus.items.map((item) => [item.quoteItemId, item.remainingQuantity] as const),
    );

    const invoiceItems = body.items
      .filter((line) => line.quantity > 0)
      .map((line) => {
        const quoteItem = quoteItemById.get(line.quoteItemId);
        if (!quoteItem) {
          throw new BadRequestException(
            `Quote item ${line.quoteItemId} does not belong to quote ${body.quoteId}`,
          );
        }
        const remaining = remainingByItemId.get(line.quoteItemId) ?? 0;
        if (line.quantity > remaining + 1e-9) {
          throw new BadRequestException(
            `Requested quantity ${line.quantity} for item "${quoteItem.description}" exceeds remaining quantity ${remaining}`,
          );
        }
        return {
          name: quoteItem.name,
          description: quoteItem.description ?? undefined,
          quantity: line.quantity,
          unitPrice: quoteItem.unitPrice,
          vatRate: quoteItem.vatRate,
          type: quoteItem.type,
          order: quoteItem.order,
          discountRate: quoteItem.discountRate,
          discountAmount: quoteItem.discountAmount ?? undefined,
          discountAmountMinor: quoteItem.discountAmountMinor ?? undefined,
          chargeAmount: quoteItem.chargeAmount ?? undefined,
          chargeAmountMinor: quoteItem.chargeAmountMinor ?? undefined,
          chargeDescription: quoteItem.chargeDescription ?? undefined,
          unitOfMeasure: quoteItem.unitOfMeasure,
          quoteItemId: quoteItem.id,
        };
      });

    if (invoiceItems.length === 0) {
      throw new BadRequestException('No items selected to invoice');
    }

    const newInvoice = await this.createInvoice(companyId, {
      clientId: quote.clientId,
      quoteId: quote.id,
      dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      items: invoiceItems,
      currency: quote.currency,
      notes: quote.notes || '',
      paymentMethodId: (quote as any).paymentMethodId || undefined,
      paymentMethod: (quote as any).paymentMethod || undefined,
      paymentDetails: (quote as any).paymentDetails || undefined,
    });

    logger.info('Invoice created from quote', {
      category: 'invoice',
      details: { invoiceId: newInvoice.id, quoteId: quote.id },
    });

    try {
      await this.webhookDispatcher.dispatch(WebhookEvent.INVOICE_CREATED_FROM_QUOTE, {
        invoice: newInvoice,
        quote,
        client: quote.client,
        company: quote.company,
      });
    } catch (error) {
      logger.error('Failed to dispatch INVOICE_CREATED_FROM_QUOTE webhook', {
        category: 'invoice',
        details: { error },
      });
    }

    return newInvoice;
  }

  /**
   * Computes how much of each quote item has already been invoiced across
   * all invoices created from this quote, and the remaining invoicable total.
   */
  async getQuoteInvoicingStatus(companyId: string, quoteId: string) {
    const quote = await prisma.quote.findFirst({
      where: { id: quoteId, companyId },
      include: {
        items: {
          include: {
            // Soft-deleted invoices (isActive: false) must not count towards
            // the invoiced quantity, otherwise deleting an invoice never
            // frees up the quote items it was created from.
            invoiceItems: { where: { invoice: { isActive: true } }, select: { quantity: true } },
          },
        },
      },
    });

    if (!quote) {
      logger.error('Quote not found when computing invoicing status', {
        category: 'invoice',
        details: { quoteId },
      });
      throw new NotFoundException('Quote not found');
    }

    const discountFactor = 1 - clampDiscountRate(quote.discountRate) / 100;

    const items = quote.items.map((item) => {
      const invoicedQuantity = item.invoiceItems.reduce((sum, inv) => sum + inv.quantity, 0);
      const remainingQuantity = Math.max(0, item.quantity - invoicedQuantity);
      const remainingTTC =
        remainingQuantity * item.unitPrice * discountFactor * (1 + (item.vatRate || 0) / 100);
      return {
        quoteItemId: item.id,
        name: item.name,
        description: item.description,
        quantity: item.quantity,
        invoicedQuantity,
        remainingQuantity,
        remainingTTC,
      };
    });

    const totalTTC = quote.totalTTC;
    const remainingTTC = items.reduce((sum, item) => sum + item.remainingTTC, 0);
    const remainingPercent = totalTTC > 0 ? (remainingTTC / totalTTC) * 100 : 0;

    return {
      items,
      totalTTC,
      remainingTTC,
      remainingPercent,
    };
  }

  async archiveInvoice(companyId: string, invoiceId: string) {
    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, companyId },
      include: {
        client: { include: { partyIdentifiers: true } },
        company: { include: { partyIdentifiers: true } },
      },
    });

    if (!invoice) {
      logger.error('Invoice not found when trying to archive', {
        category: 'invoice',
        details: { invoiceId },
      });
      throw new NotFoundException('Invoice not found');
    }

    if (invoice.status !== 'PAID') {
      logger.error('Only paid invoices can be archived', {
        category: 'invoice',
        details: { invoiceId, status: invoice.status },
      });
      throw new BadRequestException('Only paid invoices can be archived');
    }

    const archivedInvoice = await prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: 'ARCHIVED' },
    });

    // Audit: record ARCHIVED event
    let archivedDocId: string | undefined;
    try {
      const complianceDoc = await prisma.complianceDocument.findFirst({
        where: { invoiceId },
        orderBy: { createdAt: 'desc' },
      });
      if (complianceDoc) {
        archivedDocId = complianceDoc.id;
        await this.complianceService.recordAuditEvent(complianceDoc.id, 'ARCHIVED', `PAID→ARCHIVED`);
      }
    } catch (error) {
      if (archivedDocId) {
        await this.reportComplianceWiringFailure(archivedDocId, 'recordAuditEvent(ARCHIVED)', error);
      } else {
        logger.error(
          'ComplianceService.recordAuditEvent(ARCHIVED) failed — no compliance document found (non-blocking)',
          {
            category: 'invoice',
            details: { invoiceId, error: String(error) },
          },
        );
      }
    }

    logger.info('Invoice archived', { category: 'invoice', details: { invoiceId } });

    try {
      await this.webhookDispatcher.dispatch(WebhookEvent.INVOICE_STATUS_CHANGED, {
        invoice: archivedInvoice,
        client: invoice.client,
        company: invoice.company,
        previousStatus: invoice.status,
        newStatus: archivedInvoice.status,
      });
    } catch (error) {
      logger.error('Failed to dispatch INVOICE_STATUS_CHANGED webhook', {
        category: 'invoice',
        details: { error },
      });
    }

    return archivedInvoice;
  }

  async sendInvoiceByEmail(companyId: string, invoiceId: string) {
    let invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, companyId },
      include: {
        client: { include: { partyIdentifiers: true } },
        company: { include: { partyIdentifiers: true } },
        items: true,
      },
    });

    if (!invoice) {
      logger.error('Invoice not found', { category: 'invoice' });
      throw new NotFoundException('Invoice not found');
    }

    // If the invoice is still a DRAFT, issue it first
    if (invoice.status === 'DRAFT' || invoice.number === null) {
      invoice = await this.issueInvoice(companyId, invoiceId);
    }

    // If client has no email, skip sending and return an informative message
    if (!invoice.client?.contactEmail) {
      logger.error('Client has no email configured; invoice not sent', { category: 'invoice' });
      return { message: 'Client has no email configured; invoice not sent' };
    }

    // Build → transmit (real email via config-driven plan) → archive → report
    const complianceDoc = await prisma.complianceDocument.findFirst({
      where: { invoiceId },
      orderBy: { createdAt: 'desc' },
    });
    if (!complianceDoc) {
      throw new BadRequestException('No compliance document for invoice');
    }

    // QUEUE_IMPL_PLAN.md §5.6 — branch by the PRIMARY channel's feedback model, not by name (despite
    // this method's name, it is the single "send" entry point for every channel: EMAIL, PDP, KSeF,
    // SdI, Peppol, …). feedback === 'NONE' (or no provider resolved) means there is no lifecycle
    // driver to arm (fire-and-forget, e.g. plain email) — keep send() fully synchronous, unchanged.
    // Any ASYNC feedback (ASYNC_POLL: KSeF/PAC/OSE; ASYNC_CALLBACK: PDP/SdI/Peppol) enqueues
    // compliance-transmit instead: the real transmit + lifecycle arming then happens in
    // TransmitProcessor (nest/queue/processors/transmit.processor.ts), consumed inline when
    // WORKER_INLINE=true (the mono default) or by a dedicated worker process otherwise.
    const plan = complianceDoc.plan as unknown as CompliancePlan | null;
    const primaryChannel = plan?.channels?.[0];
    const provider = primaryChannel ? this.transmissionRegistry.resolve(primaryChannel) : null;
    const feedback = provider?.feedback ?? 'NONE';

    try {
      if (feedback === 'NONE') {
        await this.complianceService.send(complianceDoc.id);
      } else {
        await this.complianceQueue.enqueueTransmit(complianceDoc.id);
      }
    } catch (error) {
      if (error instanceof FormatValidationError) {
        // M-1: the compliance artifact failed format validation (e.g. an EN16931 Schematron BR-*
        // rule) — ComplianceService.send() / TransmitProcessor already aborted BEFORE any
        // transport attempt and recorded the first-class VALIDATION_BLOCKED event. This has
        // NOTHING to do with SMTP/transport — surface the real validation failures honestly
        // instead of the generic "check your SMTP configuration" message below, which would send
        // the user chasing a config that was never the problem.
        logger.error('Invoice failed compliance format validation before send', {
          category: 'invoice',
          details: { error: error.message, failures: error.failures },
        });
        const details = error.failures
          .flatMap((f) => f.errors.map((e) => `[${f.syntax}/${f.role}] ${e}`))
          .join('; ');
        throw new BadRequestException(
          `Invoice failed compliance format validation and was not sent: ${details || error.message}`,
        );
      }
      logger.error('Failed to send invoice', { category: 'invoice', details: { error } });
      throw new BadRequestException('Failed to send invoice email. Please check your SMTP configuration.');
    }

    try {
      await prisma.invoice.update({
        where: { id: invoiceId },
        data: { status: 'SENT' },
      });
    } catch (error) {
      logger.error('Failed to update invoice status after sending', {
        category: 'invoice',
        details: { error },
      });
    }

    try {
      await this.webhookDispatcher.dispatch(WebhookEvent.INVOICE_SENT, {
        invoice,
        client: invoice.client,
        company: invoice.company,
        sentAt: new Date(),
      });
    } catch (error) {
      logger.error('Failed to dispatch INVOICE_SENT webhook', { category: 'invoice', details: { error } });
    }

    return { message: 'Invoice sent successfully' };
  }

  // ──────────────────────────────────────────────────────────────────────
  //  III.4 — Proforma
  // ──────────────────────────────────────────────────────────────────────

  async createProformaInvoice(companyId: string, body: CreateInvoiceDto) {
    const { items, ...data } = body;

    const company = await prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      include: { partyIdentifiers: true },
    });

    const client = await prisma.client.findFirst({
      where: { id: body.clientId, companyId },
      include: { partyIdentifiers: true },
    });
    if (!client) throw new BadRequestException('Client not found');

    const discountRate = clampDiscountRate(body.discountRate);
    const taxResult = resolveTax(company, client, {
      currency: body.currency || client.currency || company.currency,
      discountRate,
      items,
    });

    if (taxResult.warnings.length > 0) {
      logger.warn('Tax resolution warnings (proforma)', {
        category: 'invoice',
        details: { warnings: taxResult.warnings },
      });
    }

    const invoice = await prisma.invoice.create({
      data: {
        ...data,
        kind: 'PROFORMA',
        status: 'DRAFT',
        currency: body.currency || client.currency || company.currency,
        companyId: company.id,
        clientId: client.id,
        discountRate,
        totalHT: taxResult.totalHT,
        totalHTMinor: taxResult.totalsMinor.netMinor,
        totalVAT: taxResult.totalVAT,
        totalVATMinor: taxResult.totalsMinor.taxMinor,
        totalTTC: taxResult.totalTTC,
        totalTTCMinor: taxResult.totalsMinor.grossMinor,
        items: {
          create: items.map((item, i) => ({
            ...invoiceItemData(
              item,
              body.currency || client.currency || company.currency,
              taxResult.itemVatRates[i],
            ),
            name: item.name,
          })),
        },
        dueDate: data.dueDate ? new Date(data.dueDate) : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      },
      include: {
        items: true,
        client: { include: { partyIdentifiers: true } },
        company: { include: { partyIdentifiers: true } },
      },
    });

    // Non-blocking: compliance draft (tracking only — proforma is never issued)
    try {
      const complianceCtx = buildComplianceContext(company, client, {
        lines: toComplianceLines(items, body.currency || client.currency || company.currency),
        issueDate: new Date(),
        currency: body.currency || client.currency || company.currency,
        externalRef: invoice.id,
      });
      await this.complianceService.createDraft(complianceCtx, 'PROFORMA', invoice.id);
    } catch (error) {
      // M-2: createDraft itself failed — no document exists yet to attach a WIRING_FAILED event
      // to; the missing compliance document IS the visible signal. Upgraded warn → error.
      logger.error(
        'ComplianceService.createDraft failed for proforma — invoice has no compliance document (non-blocking)',
        {
          category: 'invoice',
          details: {
            invoiceId: invoice.id,
            operation: 'createProformaInvoice.createDraft',
            error: String(error),
          },
        },
      );
    }

    logger.info('Proforma created', { category: 'invoice', details: { invoiceId: invoice.id } });
    return invoice;
  }

  async convertProformaToInvoice(companyId: string, proformaId: string) {
    const proforma = await prisma.invoice.findFirst({
      where: { id: proformaId, companyId },
      include: { items: true },
    });

    if (!proforma) throw new NotFoundException('Invoice not found');
    if (proforma.kind !== 'PROFORMA')
      throw new BadRequestException('Only PROFORMA invoices can be converted');

    const newInvoice = await this.createInvoice(companyId, {
      clientId: proforma.clientId,
      items: proforma.items.map((item) => ({
        name: item.name,
        description: item.description ?? undefined,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        // Prefer the proforma item's own ORIGINAL hint (requestedVatRate) over its resolved
        // vatRate — same rationale as issueInvoice's recompute: the resolved rate may be a
        // stale-0 forced by a country-less client at proforma-creation time, and re-hinting
        // that verbatim into createInvoice (which trusts a hint as-is) would reproduce the
        // under-charge this branch exists to prevent. Legacy proforma rows (requestedVatRate
        // null, created before this field existed) fall back to the resolved vatRate.
        vatRate: item.requestedVatRate ?? item.vatRate,
        type: item.type,
        order: item.order,
        discountRate: item.discountRate,
        discountAmount: item.discountAmount ?? undefined,
        chargeAmount: item.chargeAmount ?? undefined,
        chargeDescription: item.chargeDescription ?? undefined,
        unitOfMeasure: item.unitOfMeasure,
      })),
      currency: proforma.currency,
      notes: proforma.notes || '',
      paymentMethodId: proforma.paymentMethodId || undefined,
      paymentMethod: proforma.paymentMethod || undefined,
      paymentDetails: proforma.paymentDetails || undefined,
      discountRate: proforma.discountRate ?? undefined,
      dueDate: proforma.dueDate,
      depositOfInvoiceId: proforma.depositOfInvoiceId || undefined,
    });

    logger.info('Proforma converted to invoice', {
      category: 'invoice',
      details: { proformaId, newInvoiceId: newInvoice.id },
    });
    return newInvoice;
  }

  // ──────────────────────────────────────────────────────────────────────
  //  III.4 — Deposit (standalone)
  // ──────────────────────────────────────────────────────────────────────

  async getUnlinkedDeposits(companyId: string, clientId: string) {
    return prisma.invoice.findMany({
      where: {
        companyId,
        clientId,
        kind: 'DEPOSIT',
        depositOfInvoiceId: null,
        isActive: true,
      },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createDepositInvoice(
    companyId: string,
    body: CreateInvoiceDto & { amount?: number; percentage?: number },
  ) {
    const { items: _ignoredItems, amount, percentage, ...rest } = body as any;

    const company = await prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      include: { partyIdentifiers: true },
    });

    const client = await prisma.client.findFirst({
      where: { id: body.clientId, companyId },
      include: { partyIdentifiers: true },
    });
    if (!client) throw new BadRequestException('Client not found');

    // Standalone deposits are created directly as ISSUED (no DRAFT phase) — hard-block here too,
    // same as issueInvoice, so a country-less client can never get a silently under-charged (0% VAT)
    // deposit invoice.
    resolveBuyerCountryOrThrow(client);

    // Compute deposit total TTC from amount or percentage
    let depositTTC: number;
    if (typeof amount === 'number' && amount > 0) {
      depositTTC = amount;
    } else if (typeof percentage === 'number' && percentage > 0 && percentage <= 100) {
      // Standalone deposit: no parent invoice — percentage is of the body's own total (or 0).
      // When linked to a parent at final-creation time, the percentage semantics are:
      // "X% of the parent invoice total". For standalone creation, we require `amount`.
      throw new BadRequestException(
        'Standalone deposit invoices require an explicit amount (percentage is only meaningful when linked to a parent invoice).',
      );
    } else {
      throw new BadRequestException('Provide either amount or a valid percentage (1-100).');
    }

    // Use the compliance engine to resolve VAT on the deposit line.
    // amount is TTC (the user specifies the gross deposit). We derive HT
    // so that HT + VAT === TTC holds by construction.
    const vatRate = body.items?.[0]?.vatRate ?? 20;

    // Resolve the effective VAT rate for this buyer/supply first (rate is amount-independent).
    const taxResult = resolveTax(company, client, {
      currency: body.currency || client.currency || company.currency,
      discountRate: 0,
      items: [{ quantity: 1, unitPrice: depositTTC, vatRate, supplyType: 'SERVICES' }],
    });
    const depositItemVatRate = taxResult.itemVatRates[0] ?? vatRate;

    // Derive HT/VAT from the RESOLVED rate so the stored totals match the line's actual rate
    // (e.g. an export/reverse-charge resolves to 0% => HT === TTC and VAT === 0, not a phantom 20%).
    const depositHT = depositTTC / (1 + depositItemVatRate / 100);
    const depositVAT = depositTTC - depositHT;

    const issueDate = new Date();
    const currency = body.currency || client.currency || company.currency;

    const depositInvoice = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const { counter, rawNumber } = await this.numberingService.nextNumber(
        tx,
        company.id,
        'invoice',
        issueDate,
      );

      return tx.invoice.create({
        data: {
          kind: 'DEPOSIT',
          status: 'ISSUED',
          number: counter,
          rawNumber,
          issuedAt: issueDate,
          clientId: client.id,
          companyId: company.id,
          currency,
          dueDate: body.dueDate ? new Date(body.dueDate) : issueDate,
          notes: body.notes || `Deposit invoice — standalone`,
          totalHT: depositHT,
          totalHTMinor: toMinor(depositHT, currency),
          totalVAT: depositVAT,
          totalVATMinor: toMinor(depositVAT, currency),
          totalTTC: depositTTC,
          totalTTCMinor: toMinor(depositTTC, currency),
          items: {
            create: [
              {
                name: 'Deposit payment',
                description: 'Deposit payment',
                quantity: 1,
                unitPrice: depositHT,
                unitPriceMinor: toMinor(depositHT, currency),
                vatRate: depositItemVatRate,
                requestedVatRate: vatRate,
                type: 'DEPOSIT',
                order: 0,
                unitOfMeasure: 'C62',
              },
            ],
          },
        },
        include: {
          items: true,
          client: { include: { partyIdentifiers: true } },
          company: { include: { partyIdentifiers: true } },
        },
      });
    });

    // Non-blocking: ComplianceService createDraft + issue
    let depositDocId: string | undefined;
    try {
      const complianceCtx = buildComplianceContext(company, client, {
        lines: [
          {
            id: 'deposit-line',
            description: 'Deposit payment',
            quantity: 1,
            unitNetMinor: toMinor(depositHT, currency),
            supplyType: 'SERVICES',
          },
        ],
        issueDate,
        currency,
        externalRef: depositInvoice.id,
      });
      const doc = await this.complianceService.createDraft(complianceCtx, 'DEPOSIT', depositInvoice.id);
      depositDocId = doc.id;
      await this.complianceService.issue(doc.id);
    } catch (error) {
      if (depositDocId) {
        await this.reportComplianceWiringFailure(depositDocId, 'createDepositInvoice', error);
      } else {
        logger.error(
          'ComplianceService wiring for deposit failed — invoice has no compliance document (non-blocking)',
          {
            category: 'invoice',
            details: { depositInvoiceId: depositInvoice.id, error: String(error) },
          },
        );
      }
    }

    logger.info('Deposit invoice created', {
      category: 'invoice',
      details: { depositInvoiceId: depositInvoice.id, rawNumber: depositInvoice.rawNumber },
    });
    return depositInvoice;
  }

  // ──────────────────────────────────────────────────────────────────────
  //  III.4 — Final invoice (with deposit deduction)
  // ──────────────────────────────────────────────────────────────────────

  async createFinalInvoice(companyId: string, body: CreateInvoiceDto & { depositInvoiceIds: string[] }) {
    const { depositInvoiceIds, items, ...data } = body as any;

    if (!depositInvoiceIds?.length) {
      throw new BadRequestException('A final invoice must reference at least one deposit invoice.');
    }

    const company = await prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      include: { partyIdentifiers: true },
    });

    const client = await prisma.client.findFirst({
      where: { id: body.clientId, companyId },
      include: { partyIdentifiers: true },
    });
    if (!client) throw new BadRequestException('Client not found');

    // Fetch all deposit invoices and validate
    const deposits = await prisma.invoice.findMany({
      where: { id: { in: depositInvoiceIds }, companyId },
      include: { items: true },
    });

    if (deposits.length !== depositInvoiceIds.length) {
      throw new BadRequestException('One or more deposit invoices not found.');
    }
    for (const dep of deposits) {
      if (dep.kind !== 'DEPOSIT')
        throw new BadRequestException(`Invoice ${dep.id} is not a deposit invoice (kind=${dep.kind}).`);
      if (dep.depositOfInvoiceId)
        throw new BadRequestException(`Deposit invoice ${dep.id} is already linked to another invoice.`);
      if (dep.clientId !== body.clientId)
        throw new BadRequestException(`Deposit invoice ${dep.id} belongs to a different client.`);
    }

    const currency = body.currency || client.currency || company.currency;
    const totalDeposited = deposits.reduce((sum, d) => sum + d.totalTTC, 0);

    // Compute VAT on the deduction line — [~] The VAT treatment of deposit deductions
    // is country-specific (FR: the deposit invoice already carried VAT, so the deduction
    // line is a credit of the same VAT). totalDeposited is TTC; derive HT to keep the
    // invariant HT+VAT===TTC.
    const depositVatRate = deposits[0]?.items?.[0]?.vatRate ?? 20;
    const deductionHT = -totalDeposited / (1 + depositVatRate / 100);
    const deductionVAT = -totalDeposited - deductionHT;

    const deductionTaxResult = resolveTax(company, client, {
      currency,
      discountRate: 0,
      items: [{ quantity: 1, unitPrice: deductionHT, vatRate: depositVatRate, supplyType: 'SERVICES' }],
    });

    // Build the deduction line item
    const deductionLine = {
      description: `Deposit deduction (${deposits.length} deposit(s): ${deposits.map((d) => d.rawNumber || d.number?.toString() || d.id.slice(0, 8)).join(', ')})`,
      quantity: 1,
      unitPrice: deductionHT,
      unitPriceMinor: toMinor(deductionHT, currency),
      vatRate: deductionTaxResult.itemVatRates[0] ?? depositVatRate,
      requestedVatRate: depositVatRate,
      type: 'DEPOSIT' as const,
      order: items?.length ?? 0,
      unitOfMeasure: 'C62',
    };

    const allItems = [
      ...(items ?? []).map((item: any, i: number) => ({
        ...invoiceItemData(item, currency, item.vatRate),
        order: i,
      })),
      deductionLine,
    ];

    // Tax resolution for the full set (work items + deduction line)
    const fullTaxResult = resolveTax(company, client, {
      currency,
      discountRate: clampDiscountRate(body.discountRate),
      items: allItems,
    });

    if (fullTaxResult.warnings.length > 0) {
      logger.warn('Tax resolution warnings (final invoice)', {
        category: 'invoice',
        details: { warnings: fullTaxResult.warnings },
      });
    }

    // Create the final invoice + link deposits in one transaction
    // NOTE: DRAFT = no number. The gapless number is assigned at issue() time.
    const finalInvoice = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const created = await tx.invoice.create({
        data: {
          kind: 'FINAL',
          status: 'DRAFT',
          clientId: client.id,
          companyId: company.id,
          currency,
          discountRate: clampDiscountRate(body.discountRate),
          totalHT: fullTaxResult.totalHT,
          totalHTMinor: fullTaxResult.totalsMinor.netMinor,
          totalVAT: fullTaxResult.totalVAT,
          totalVATMinor: fullTaxResult.totalsMinor.taxMinor,
          totalTTC: fullTaxResult.totalTTC,
          totalTTCMinor: fullTaxResult.totalsMinor.grossMinor,
          dueDate: body.dueDate ? new Date(body.dueDate) : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
          notes: body.notes || '',
          paymentMethodId: body.paymentMethodId,
          items: {
            create: allItems.map((item, i) => ({
              ...item,
              order: i,
            })),
          },
        },
        include: {
          items: true,
          client: { include: { partyIdentifiers: true } },
          company: { include: { partyIdentifiers: true } },
        },
      });

      // Link deposit invoices to this final invoice
      await tx.invoice.updateMany({
        where: { id: { in: depositInvoiceIds } },
        data: { depositOfInvoiceId: created.id },
      });

      return created;
    });

    logger.info('Final invoice created', {
      category: 'invoice',
      details: { finalInvoiceId: finalInvoice.id, depositCount: deposits.length, totalDeposited },
    });
    return finalInvoice;
  }

  async getAvailableActions(companyId: string, id: string) {
    const invoice = await prisma.invoice.findFirst({ where: { id, companyId } });
    if (!invoice) throw new NotFoundException('Invoice not found');

    const complianceDoc = await prisma.complianceDocument.findFirst({
      where: { invoiceId: id },
      orderBy: { createdAt: 'desc' },
      include: {
        // M-2: needed to derive `complianceError` — the most recent event, when it's a
        // WIRING_FAILED, is the UI-visible signal that the document's intended action failed on a
        // non-blocking integration point (see ComplianceService.recordWiringFailure).
        events: { select: { type: true, at: true, detail: true }, orderBy: { at: 'asc' as const } },
      },
    });

    if (!complianceDoc || !complianceDoc.plan) {
      return {
        invoiceId: id,
        status: invoice.status,
        complianceStatus: complianceDoc?.status ?? null,
        complianceError: deriveComplianceError(complianceDoc?.events),
        immutableAfter: 'ISSUE',
        correctionModel: 'CREDIT_NOTE',
        cancellation: { allowed: false },
        actions: deriveInvoiceActions(invoice, null),
        correctionKinds: ['CREDIT_NOTE'],
        flow: null,
      };
    }

    const plan = complianceDoc.plan as unknown as CompliancePlan;
    const lifecycle = plan.lifecycle;

    const pctx = phaseContextFromPlan(plan, defaultTransmissionRegistry);
    const graph = assembleLifecycle(plan, pctx);
    const runtime = new LifecycleRuntime(graph, complianceDoc.status as ComplianceStatus);
    const manualActions = new Set(
      runtime
        .availableActions()
        .map((t) => (t.trigger.kind === 'MANUAL' ? t.trigger.action : null))
        .filter((a): a is string => a !== null),
    );

    let correctionKinds: string[];
    switch (lifecycle.correctionModel) {
      case 'CORRECTIVE_INVOICE':
        correctionKinds = ['CORRECTIVE_INVOICE'];
        break;
      case 'CANCEL_AND_REPLACE':
        correctionKinds = ['INVOICE'];
        break;
      default:
        correctionKinds = ['CREDIT_NOTE'];
    }

    let cancelReason: string | undefined;
    if (!lifecycle.cancellation?.allowed) {
      cancelReason = 'Cancellation not allowed by country policy; issue a credit note.';
    } else if (lifecycle.cancellation?.requiresAuthorityAck) {
      cancelReason = 'Requires authority acknowledgement.';
    } else if (lifecycle.cancellation?.requiresBuyerConsent) {
      cancelReason = 'Requires buyer consent.';
    }

    return {
      invoiceId: id,
      status: invoice.status,
      complianceStatus: complianceDoc.status,
      complianceError: deriveComplianceError(complianceDoc.events),
      kind: invoice.kind,
      immutableAfter: lifecycle.immutableAfter,
      correctionModel: lifecycle.correctionModel,
      cancellation: {
        allowed: manualActions.has('cancel'),
        reason: cancelReason,
      },
      actions: deriveInvoiceActions(invoice, manualActions, lifecycle.correctionModel),
      correctionKinds,
      flow: describeFlow(plan, complianceDoc.status as ComplianceStatus),
    };
  }
}
