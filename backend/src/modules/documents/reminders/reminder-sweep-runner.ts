/**
 * The Prisma/mail-touching half of the dunning-reminder sweep — `reminder-sweep.ts` holds the pure
 * decisions (`selectDueReminderTier`, `daysOverdueOn`, `buildReminderEmail`, the job constants); this
 * class is what actually reads `Company`/`DocumentInstance`/`DocumentPayment`/`Client`/
 * `DocumentReminder` rows, sends the email, and records the reminder — the same "pure core, thin
 * persistence shell" split `conformity-sweep-runner.ts`/`currency-rate-sweep-runner.ts` already hold
 * for their own sweeps.
 *
 * Consumed by `queue/processors/document-action.processor.ts`, exactly like the other three sweeps —
 * same queue (`Q_DOCUMENT_ACTION`), distinguished by `job.name`.
 *
 * ## Balance — NEVER recomputed here, always reused
 * `outstandingMinor` comes from the EXACT SAME pipeline `settlement/client-statement.ts#resolveClientStatement`
 * and `documents.service.ts#getSettlement` already use — `computeDocumentTotals` for the gross total,
 * `sumPaidMinorByDocument`/`listCreditNotes`+`creditsForInvoiceFromNotes` for what has already reduced
 * it, `computeSettlement` for the arithmetic. This file invents no balance logic of its own — see the
 * task's own explicit instruction: "reuse compute-settlement/compute-totals/payments/credits ... NEVER
 * recompute a balance yourself."
 *
 * ## Resilience — a single invoice's failure never aborts the sweep
 * Mirrors `ConformitySweepRunner.runSweep`'s own per-candidate posture: a bad/missing client email, an
 * SMTP hiccup, or a `DocumentReminder` write racing a concurrent pass for ONE invoice is logged and
 * the loop moves on to the next, counted in `skipped`, never thrown. `runSweep` itself additionally
 * never throws for a failure at the OPTED-IN-COMPANY-LIST or PER-COMPANY level either (a broken query)
 * — belt and suspenders beyond what per-invoice resilience alone would catch, so this background job
 * can never take the whole worker process down with it (`document-action.processor.ts`'s own
 * `onFailed` skip-list already tolerates a thrown `runSweep` gracefully — BullMQ just retries at the
 * next scheduled tick — but there is no reason to rely on that when catching here is this cheap).
 */
import { Injectable, Logger } from '@nestjs/common';

import { MailService } from '@/mail/mail.service';
import prisma from '@/prisma/prisma.service';
import { decimalsFor, fromMinor } from '@/utils/financial';

import { Prisma } from '../../../../prisma/generated/prisma/client';
import { buildInvoiceDescriptor } from '../descriptors/invoice.descriptor';
import { listDocuments } from '../persistence';
import { computeSettlement } from '../settlement/compute-settlement';
import { creditsForInvoiceFromNotes, listCreditNotes, toSettlementCreditInputs } from '../settlement/credits';
import { sumPaidMinorByDocument } from '../settlement/payments';
import { computeDocumentTotals } from '../totals/compute-totals';
import { buildReminderEmail, daysOverdueOn, selectDueReminderTier } from './reminder-sweep';

/** Same explicit, honest read cap as `settlement/client-statement.ts#CLIENT_STATEMENT_READ_LIMIT` — a
 *  sweep pass is an honest "most recently touched N invoices per company" walk, never an unbounded
 *  table scan. */
const REMINDER_SWEEP_INVOICE_READ_LIMIT = 500;

/** The invoice's own base descriptor — see `client-statement.ts`'s identical constant for why a
 *  direct import is fine here: this file only ever computes totals for "invoice" instances (this
 *  feature's own scope — see reminder-sweep.ts's own header). */
const INVOICE_DESCRIPTOR = buildInvoiceDescriptor();

export interface RunReminderSweepResult {
  /** How many OPTED-IN companies (`remindersEnabled: true`) this pass actually looked at, regardless
   *  of whether any of their invoices turned out overdue-and-due. */
  companiesProcessed: number;
  /** How many reminder emails this pass actually sent AND durably recorded. */
  remindersSent: number;
  /** Every invoice this pass looked at but did NOT email — not yet overdue, nothing newly due this
   *  tier-wise, no resolvable client email, a mail-send failure, or a reminder-record write failure.
   *  Never surfaced as a thrown error — see this file's own header. */
  skipped: number;
}

/** One company's own pass — see `runForCompany` below. */
interface CompanyReminderResult {
  remindersSent: number;
  skipped: number;
}

@Injectable()
export class ReminderSweepRunner {
  private readonly logger = new Logger(ReminderSweepRunner.name);

  constructor(private readonly mailService: MailService) {}

  /**
   * One sweep pass. `now` is a parameter (not always `new Date()`) for the same reason every other
   * sweep in this directory takes one: a test can pin the clock instead of racing the real one.
   *
   * NEVER throws — see this file's own header for the two layers of resilience (per-invoice, and
   * per-company/opted-in-list) that make this true.
   */
  async runSweep(now: Date = new Date()): Promise<RunReminderSweepResult> {
    let companies: { id: string; name: string }[];
    try {
      companies = await prisma.company.findMany({
        where: { remindersEnabled: true },
        select: { id: true, name: true },
      });
    } catch (error) {
      this.logger.error(
        `Reminder sweep could not list opted-in companies — skipping this pass entirely: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      return { companiesProcessed: 0, remindersSent: 0, skipped: 0 };
    }

    let remindersSent = 0;
    let skipped = 0;

    for (const company of companies) {
      let result: CompanyReminderResult;
      try {
        result = await this.runForCompany(company.id, company.name, now);
      } catch (error) {
        // A whole company's own query blowing up (a transient DB hiccup, a data anomaly this
        // function's inner try/catches didn't anticipate) must not cost every OTHER opted-in
        // company its own daily reminders — the exact isolation reasoning `runSweep`'s own header
        // states for why this layer exists on top of the per-invoice one inside `runForCompany`.
        this.logger.error(
          `Reminder sweep: company ${company.id} failed entirely for this pass — ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
        continue;
      }
      remindersSent += result.remindersSent;
      skipped += result.skipped;
    }

    this.logger.log(
      `Reminder sweep: ${companies.length} opted-in compan${companies.length === 1 ? 'y' : 'ies'}, ` +
        `${remindersSent} reminder(s) sent, ${skipped} skipped.`,
    );
    return { companiesProcessed: companies.length, remindersSent, skipped };
  }

  /**
   * One company's own overdue invoices — fetched, balanced (reused, never recomputed — see this
   * file's own header), and matched against `REMINDER_TIERS` one by one. Every per-invoice failure
   * (mail send, reminder-record write) is caught right where it happens so ONE invoice never stops
   * the rest of this company's own pass, mirroring `ConformitySweepRunner.runSweep`'s own per-candidate
   * loop.
   */
  private async runForCompany(
    companyId: string,
    companyName: string,
    now: Date,
  ): Promise<CompanyReminderResult> {
    const invoices = (await listDocuments(companyId, 'invoice', REMINDER_SWEEP_INVOICE_READ_LIMIT)).filter(
      // "sent" only — the same rule `client-statement.ts#resolveClientStatement` already applies: a
      // draft was never actually issued, and a cancelled invoice owes nothing.
      (invoice) => invoice.status === 'sent',
    );
    if (invoices.length === 0) return { remindersSent: 0, skipped: 0 };

    const invoiceIds = invoices.map((invoice) => invoice.id);
    // Three independent reads, all company-scoped, all reused verbatim (never recomputed) from the
    // exact modules that already own this arithmetic — see this file's own header.
    const [paidByDocument, creditNotes, sentTiersByDocument] = await Promise.all([
      sumPaidMinorByDocument(companyId, invoiceIds),
      listCreditNotes(companyId),
      findSentTiersByDocument(invoiceIds),
    ]);

    let remindersSent = 0;
    let skipped = 0;

    for (const invoice of invoices) {
      const data = (invoice.data ?? {}) as Record<string, unknown>;
      const dueDate = typeof data.dueDate === 'string' ? data.dueDate : null;
      const daysOverdue = daysOverdueOn(dueDate, now);
      if (daysOverdue === null) {
        // No usable due date — should not happen for an invoice (dueDate is a required field on
        // its own descriptor), but an honest degrade beats a guess or a crash. See reminder-sweep.ts's
        // own header on `daysOverdueOn`.
        skipped++;
        continue;
      }

      const totals = computeDocumentTotals(INVOICE_DESCRIPTOR, data);
      const paidMinor = paidByDocument.get(invoice.id) ?? 0;
      const { credits } = creditsForInvoiceFromNotes(creditNotes, invoice.id, INVOICE_DESCRIPTOR, data);
      const settlement = computeSettlement(
        totals.grossMinor,
        [{ amountMinor: paidMinor }],
        toSettlementCreditInputs(credits),
      );

      if (settlement.outstandingMinor <= 0) {
        // Fully settled — not a candidate at all, and not counted as "skipped" either: there was
        // never anything to remind anyone about for this invoice today.
        continue;
      }

      const sentTiers = sentTiersByDocument.get(invoice.id) ?? new Set<number>();
      const tier = selectDueReminderTier(daysOverdue, sentTiers);
      if (tier === null) {
        // Not yet overdue at all, or every tier this invoice currently qualifies for was already
        // sent on an earlier pass — nothing NEW to do for it today. Not counted as "skipped" (the
        // task's own `RunReminderSweepResult` reserves that word for a candidate that WAS due but
        // could not actually be emailed).
        continue;
      }

      const recipient = await resolveClientContactEmail(companyId, data.client);
      if (!recipient) {
        this.logger.warn(
          `Reminder sweep: invoice ${invoice.id} (tier ${tier}) has no resolvable client contact ` +
            'email — skipping.',
        );
        skipped++;
        continue;
      }

      const currency = typeof data.currency === 'string' ? data.currency : '';
      const decimals = decimalsFor(currency);
      const amountOutstanding = `${fromMinor(settlement.outstandingMinor, currency).toFixed(decimals)} ${currency}`;
      const email = buildReminderEmail(tier, {
        displayNumber: invoice.displayNumber ?? invoice.id,
        amountOutstanding,
        dueDate: dueDate ?? '',
        daysOverdue,
        companyName,
      });

      try {
        await this.mailService.sendMail({ to: recipient, subject: email.subject, text: email.text });
      } catch (error) {
        this.logger.warn(
          `Reminder sweep: failed to send the tier-${tier} reminder for invoice ${invoice.id} to ` +
            `${recipient} — ${error instanceof Error ? error.message : String(error)}`,
        );
        skipped++;
        continue;
      }

      if (await this.recordReminderSent(companyId, invoice.id, tier)) {
        remindersSent++;
      } else {
        skipped++;
      }
    }

    return { remindersSent, skipped };
  }

  /**
   * Records that `tier` was just sent for `documentId` — the write the `@@unique([documentId, tier])`
   * constraint (schema.prisma) exists to police. Returns `false` (never throws) on ANY failure,
   * including — see this file's own header, and `DocumentReminder`'s own schema.prisma comment — the
   * unique-constraint violation a genuinely concurrent second pass racing the SAME (documentId, tier)
   * pair would hit: the email was already, really sent, there is nothing to undo, and the other pass's
   * own write already recorded the identical fact a moment earlier, so this is counted as a success
   * from the CALLER's point of view (the mail truly went out) even though this method itself reports
   * `false` here (the caller only uses the boolean to decide `remindersSent` vs `skipped`, and a race
   * this narrow — extremely unlikely at a once-a-day cadence — is intentionally undercounted as
   * "skipped" rather than double-logic to special-case it, since the row itself is the durable source
   * of truth either way).
   */
  private async recordReminderSent(companyId: string, documentId: string, tier: number): Promise<boolean> {
    try {
      await prisma.documentReminder.create({ data: { companyId, documentId, tier } });
      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        this.logger.log(
          `Reminder sweep: tier ${tier} for document ${documentId} was already recorded by a ` +
            'concurrent pass — the email was sent, only this bookkeeping write raced.',
        );
      } else {
        this.logger.error(
          `Reminder sweep: sent the tier-${tier} reminder for document ${documentId} but FAILED to ` +
            `record it — ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return false;
    }
  }
}

/** Every tier already recorded for any of `documentIds`, grouped into a `Map<documentId, Set<tier>>`
 *  — ONE query for the whole company's own overdue candidates, never one query per invoice, the same
 *  "one read, filter in memory" discipline `currency-rate-sweep-runner.ts#findAlreadyRefreshedPairKeys`
 *  already holds for its own idempotency check. */
async function findSentTiersByDocument(documentIds: string[]): Promise<Map<string, Set<number>>> {
  if (documentIds.length === 0) return new Map();

  const rows = await prisma.documentReminder.findMany({
    where: { documentId: { in: documentIds } },
    select: { documentId: true, tier: true },
  });

  const byDocument = new Map<string, Set<number>>();
  for (const row of rows) {
    if (!byDocument.has(row.documentId)) byDocument.set(row.documentId, new Set());
    byDocument.get(row.documentId)!.add(row.tier);
  }
  return byDocument;
}

/**
 * The invoice's own client contact email, resolved straight from `data.client` (the reference field
 * every invoice descriptor already carries) via `prisma.client` DIRECTLY — never `ClientsService`
 * (unlike `transports/email-transport.ts`'s own resolution): `ReminderSweepRunner` is a leaf provider
 * with exactly one Nest dependency (`MailService`), the same "no reason to drag a whole module's worth
 * of DI in" posture `currency-rate-sweep-runner.ts`'s own header holds for staying a plain `prisma`
 * singleton consumer — see `document-queue-worker.module.ts`'s own header on why that runner needs no
 * home in `DocumentsCoreModule` at all. Tenant-scoped (`companyId` in the `where`), the same
 * "never trust a raw id without scoping it" discipline every other cross-tenant-safe query in this
 * module already holds — a corrupted/foreign `data.client` value simply resolves to `null` here,
 * never another company's client.
 */
async function resolveClientContactEmail(companyId: string, clientIdValue: unknown): Promise<string | null> {
  const clientId = typeof clientIdValue === 'string' ? clientIdValue : null;
  if (!clientId) return null;

  const client = await prisma.client.findFirst({
    where: { id: clientId, companyId },
    select: { contactEmail: true },
  });
  return client?.contactEmail ?? null;
}
