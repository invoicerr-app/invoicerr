/**
 * Issues the pending subscription invoices (#760, #971 slice 10): see `subscription-invoice.ts` for the
 * whole design. Runs on the billing sweep, never inside the Stripe webhook.
 *
 * Each row moves forward one durable step at a time, and every step is written back before the next
 * one starts, so a crash or a failed send never issues a second invoice or creates a second client:
 * client created, draft saved, invoice sent, Stripe payment recorded. A row whose send is still being
 * delivered (`sending`) is picked up again on the next tick.
 *
 * The issuer company's VAT settings must match `BILLING_VAT` (under the franchise, `exemptVat` on): a
 * sent invoice whose amount due differs from what Stripe collected is left to the operator, unpaid.
 *
 * The issuer company sends like any other company, so it must be allowed to send (`assertCanSend`):
 * on a hosted instance its own subscription must be active. When it is not, nothing is attempted and
 * the reason is logged once per tick.
 */
import { Injectable, Logger } from '@nestjs/common';

import { runWithCompanyId } from '@/lib/request-context';
import { ClientsService } from '@/modules/clients/clients.service';
import { DocumentsService } from '@/modules/documents/documents.service';
import prisma from '@/prisma/prisma.service';
import { fromMinor } from '@/utils/financial';

import { assertCanSend } from './send-gate';
import {
  MANUAL_ISSUE_PREFIX,
  readInvoiceIssuerCompanyId,
  readStoredLines,
  toInvoiceLines,
} from './subscription-invoice';

/** A row failing this many times stops being retried; its `lastError` says why. */
export const MAX_ISSUE_ATTEMPTS = 10;
/** Rows handled per tick, oldest payment first. */
export const ISSUE_BATCH_SIZE = 50;

const MAX_ERROR_LENGTH = 1000;

export interface IssueSubscriptionInvoicesResult {
  /** Why nothing was attempted this tick, or null. */
  skipped: string | null;
  completed: number;
  waiting: number;
  failed: number;
}

type PendingRow = Awaited<ReturnType<typeof listPendingRows>>[number];

function listPendingRows() {
  return prisma.subscriptionInvoice.findMany({
    where: {
      paymentRecordedAt: null,
      attempts: { lt: MAX_ISSUE_ATTEMPTS },
      OR: [{ lastError: null }, { NOT: { lastError: { startsWith: MANUAL_ISSUE_PREFIX } } }],
    },
    orderBy: { paidAt: 'asc' },
    take: ISSUE_BATCH_SIZE,
  });
}

const todayIso = (now: Date): string => now.toISOString().slice(0, 10);

@Injectable()
export class SubscriptionInvoiceIssuer {
  private readonly logger = new Logger(SubscriptionInvoiceIssuer.name);

  constructor(
    private readonly documentsService: DocumentsService,
    private readonly clientsService: ClientsService,
  ) {}

  async issuePending(now: Date = new Date()): Promise<IssueSubscriptionInvoicesResult> {
    const result: IssueSubscriptionInvoicesResult = { skipped: null, completed: 0, waiting: 0, failed: 0 };
    const rows = await listPendingRows();
    if (rows.length === 0) return result;

    const issuerId = readInvoiceIssuerCompanyId();
    if (!issuerId) {
      result.skipped = 'BILLING_INVOICE_ISSUER_COMPANY_ID is not set';
      this.logger.warn(`${rows.length} paid subscription invoice(s) waiting: ${result.skipped}`);
      return result;
    }
    const issuer = await prisma.company.findUnique({ where: { id: issuerId }, select: { id: true } });
    if (!issuer) {
      result.skipped = `issuer company ${issuerId} does not exist`;
      this.logger.error(`Subscription invoices not issued: ${result.skipped}`);
      return result;
    }
    try {
      await assertCanSend(issuerId);
    } catch (error) {
      result.skipped = `issuer company ${issuerId} cannot send: ${errorMessage(error)}`;
      this.logger.error(`Subscription invoices not issued: ${result.skipped}`);
      return result;
    }

    for (const row of rows) {
      try {
        const done = await runWithCompanyId(issuerId, () => this.advance(issuerId, row, now));
        if (done) result.completed += 1;
        else result.waiting += 1;
      } catch (error) {
        result.failed += 1;
        const message = errorMessage(error).slice(0, MAX_ERROR_LENGTH);
        await prisma.subscriptionInvoice.update({
          where: { id: row.id },
          data: { attempts: { increment: 1 }, lastError: message },
        });
        this.logger.error(
          `Subscription invoice for Stripe invoice ${row.stripeInvoiceId} failed: ${message}`,
        );
      }
    }
    return result;
  }

  /** Moves one row as far as it can go; true once the payment is recorded. */
  private async advance(issuerId: string, row: PendingRow, now: Date): Promise<boolean> {
    const clientId = await this.ensureClient(issuerId, row);

    let documentId = row.documentId;
    if (!documentId) {
      const lines = readStoredLines(row.lines);
      if (lines.length === 0) throw new Error('the stored Stripe invoice has no lines');
      const today = todayIso(now);
      const draft = await this.documentsService.runAction(issuerId, 'invoice', 'save-draft', {
        data: {
          client: clientId,
          issueDate: today,
          dueDate: today,
          currency: row.currency,
          lines: toInvoiceLines(lines),
        },
      });
      if (!draft.document) throw new Error('saving the draft returned no document');
      documentId = draft.document.id;
      await prisma.subscriptionInvoice.update({ where: { id: row.id }, data: { documentId } });
    }

    let document = await this.documentsService.getDocument(issuerId, 'invoice', documentId);
    if (document.status === 'draft') {
      const sent = await this.documentsService.runAction(issuerId, 'invoice', 'send', {
        documentId,
        data: document.data as Record<string, unknown>,
        params: {},
      });
      document = sent.document ?? (await this.documentsService.getDocument(issuerId, 'invoice', documentId));
    }
    if (document.status === 'draft' || document.status === 'sending') {
      if (!row.issuedAt && document.status === 'sending') {
        await prisma.subscriptionInvoice.update({ where: { id: row.id }, data: { issuedAt: now } });
      }
      return false;
    }
    if (document.status !== 'sent') {
      throw new Error(`the invoice is "${document.status}", so the Stripe payment cannot be recorded on it`);
    }

    // The issuer's own VAT settings decide the invoice's tax, BILLING_VAT decides what Stripe charged:
    // when they disagree, the sent invoice and the payment differ, and recording it would leave a
    // false balance. The operator settles it by hand (a credit note or a manual payment).
    const { settlement } = await this.documentsService.getSettlement(issuerId, 'invoice', documentId);
    if (settlement.outstandingMinor !== row.amountPaid) {
      await prisma.subscriptionInvoice.update({
        where: { id: row.id },
        data: {
          issuedAt: row.issuedAt ?? now,
          lastError: `${MANUAL_ISSUE_PREFIX}: the invoice leaves ${settlement.outstandingMinor} due but Stripe collected ${row.amountPaid} (minor units)`,
        },
      });
      this.logger.error(
        `Subscription invoice ${documentId} does not match Stripe invoice ${row.stripeInvoiceId}`,
      );
      return false;
    }

    await this.documentsService.runAction(issuerId, 'invoice', 'record-payment', {
      documentId,
      data: document.data as Record<string, unknown>,
      params: {
        amount: fromMinor(row.amountPaid, row.currency),
        currency: row.currency,
        paidAt: row.paidAt.toISOString(),
        method: 'stripe',
        note: `Paid via Stripe (${row.stripeInvoiceId})`,
      },
    });
    await prisma.subscriptionInvoice.update({
      where: { id: row.id },
      data: { issuedAt: row.issuedAt ?? now, paymentRecordedAt: now, lastError: null },
    });
    return true;
  }

  /** The subscriber as a client of the issuer: the one an earlier row created, else a new one. */
  private async ensureClient(issuerId: string, row: PendingRow): Promise<string> {
    if (row.clientId && row.issuerCompanyId === issuerId) return row.clientId;
    if (!row.companyId) throw new Error(`no company holds Stripe customer ${row.stripeCustomerId}`);

    const earlier = await prisma.subscriptionInvoice.findFirst({
      where: { companyId: row.companyId, issuerCompanyId: issuerId, clientId: { not: null } },
      orderBy: { paidAt: 'desc' },
      select: { clientId: true },
    });
    if (earlier?.clientId) {
      const stillThere = await prisma.client.findFirst({
        where: { id: earlier.clientId, companyId: issuerId },
        select: { id: true },
      });
      if (stillThere) return this.keepClient(row.id, issuerId, stillThere.id);
    }

    const subscriber = await prisma.company.findUnique({
      where: { id: row.companyId },
      include: { partyIdentifiers: { select: { scheme: true, value: true } } },
    });
    if (!subscriber) throw new Error(`subscribing company ${row.companyId} no longer exists`);
    const identifiers = subscriber.partyIdentifiers.map(({ scheme, value }) => ({ scheme, value }));
    const created = await this.clientsService.createClient(issuerId, {
      id: '',
      name: subscriber.name,
      contactEmail: subscriber.email ?? undefined,
      address: subscriber.address,
      addressLine2: subscriber.addressLine2 ?? undefined,
      postalCode: subscriber.postalCode,
      city: subscriber.city,
      state: subscriber.state ?? undefined,
      country: subscriber.country ?? subscriber.countryCode ?? '',
      countryCode: subscriber.countryCode ?? undefined,
      currency: row.currency,
      type: 'COMPANY',
      isActive: true,
      vatRegistered: identifiers.some((entry) => entry.scheme === 'VAT'),
      identifiers,
    } as never);
    return this.keepClient(row.id, issuerId, (created as { id: string }).id);
  }

  private async keepClient(rowId: string, issuerId: string, clientId: string): Promise<string> {
    await prisma.subscriptionInvoice.update({
      where: { id: rowId },
      data: { issuerCompanyId: issuerId, clientId },
    });
    return clientId;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
