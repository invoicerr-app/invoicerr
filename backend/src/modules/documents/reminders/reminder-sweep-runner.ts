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
 *
 * ## Reservation, not record-after-send — closes a real duplicate-send bug
 * This used to send the email, THEN write the `DocumentReminder` row that marks the tier done. If that
 * write failed for any reason OTHER than the `(documentId, tier)` unique constraint (a genuine
 * concurrent pass, see below), the tier was never marked sent, and every later daily pass re-sent the
 * SAME email to the SAME customer — unbounded, silent, real commercial damage (a client getting the
 * same dunning notice two, three, ten times over).
 *
 * The fix reverses the order: `claimReminderTier` RESERVES the tier — a plain `documentReminder.create`
 * — BEFORE any email is sent, the same "atomic claim, the invariant lives in the write itself" idiom
 * `time-tracking/time-entries.service.ts#update` (`invoiceId: null` in the `where`) and
 * `bank-reconciliation/persistence.ts#claimLineForReconciliation`/`releaseLineClaim` already use for an
 * identical shape of problem elsewhere in this codebase — Postgres serializes two concurrent claims of
 * the SAME `(documentId, tier)`, so only one ever wins. Losing that race (`P2002`) now means "a
 * concurrent pass already owns this tier" and skips WITHOUT sending — an improvement over the old
 * order, which really did send twice in that narrow window.
 *
 * A tier reserved but never actually sent (the mail transport itself failed) must not stay blocked
 * forever, so `releaseReminderClaim` deletes the claim — scoped by its own row id AND the
 * `(companyId, documentId, tier)` invariant, the same compensating-rollback shape `releaseLineClaim`
 * already holds — and tomorrow's pass sees the tier unclaimed again.
 *
 * ## The trade-off this reversal makes, named explicitly
 * Reserve-then-send trades an UNBOUNDED, silent, every-day duplicate-send risk (the bug above) for, at
 * most, ONE narrow re-send — only in the case where `sendMail` throws despite the message having
 * actually gone out, an ambiguity already accepted for a FIRST attempt under the "Resilience" section
 * above. This product prefers that bounded residual over ever letting a customer receive the same
 * reminder night after night. The boundary case is not silent either: if the release write ITSELF then
 * fails, the tier stays claimed with no email ever delivered and no future pass will retry it —
 * `releaseReminderClaim` PERSISTS that fact through the DB-backed `logger` (Settings -> Logs), the same
 * visibility a mail-send failure already gets below, since this is the one outcome nothing else will
 * ever surface again.
 */
import { Injectable, Logger } from '@nestjs/common';

import { MailService } from '@/mail/mail.service';
import { logger } from '@/logger/logger.service';
import { runWithCompanyId } from '@/lib/request-context';
import prisma from '@/prisma/prisma.service';
import { decimalsFor, fromMinor } from '@/utils/financial';

import { Prisma } from '../../../../prisma/generated/prisma/client';
import { buildInvoiceDescriptor } from '../descriptors/invoice.descriptor';
import { listDocuments } from '../persistence';
import { resolveRecipientLanguage } from '../rendering/language/resolve-recipient-language';
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
    let companies: { id: string; name: string; language: string | null }[];
    try {
      companies = await prisma.company.findMany({
        where: { remindersEnabled: true },
        // `language` — the FALLBACK step of a reminder's own recipient-language resolution (see
        // `runForCompany`'s own use of `resolveRecipientLanguage`, and that function's own header for
        // why the client's choice always wins when it has one).
        select: { id: true, name: true, language: true },
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
        // Wrapped in `runWithCompanyId` — this sweep has no request of its own, and `runForCompany`
        // below (and the `mailService.sendForCompany` it calls) both write `Log` rows that need a
        // company to be scoped correctly.
        result = await runWithCompanyId(company.id, () =>
          this.runForCompany(company.id, company.name, company.language, now),
        );
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
    companyLanguage: string | null,
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

      const client = await resolveClientContact(companyId, data.client);
      if (!client?.contactEmail) {
        this.logger.warn(
          `Reminder sweep: invoice ${invoice.id} (tier ${tier}) has no resolvable client contact ` +
            'email — skipping.',
        );
        skipped++;
        continue;
      }
      const recipient = client.contactEmail;

      const currency = typeof data.currency === 'string' ? data.currency : '';
      const decimals = decimalsFor(currency);
      const amountOutstanding = `${fromMinor(settlement.outstandingMinor, currency).toFixed(decimals)} ${currency}`;
      // Per-recipient document language — the SAME resolution order a document's own PDF/send-email
      // uses (`rendering/language/resolve-recipient-language.ts`): the client's own `Client.language`
      // wins when set, else this company's own `Company.language`, else the shared default. A dunning
      // reminder is exactly the kind of mail a client with no English at all must be able to read and
      // act on without help, so this is not a cosmetic nicety.
      const language = resolveRecipientLanguage(client.language, companyLanguage);
      const email = buildReminderEmail(
        tier,
        {
          displayNumber: invoice.displayNumber ?? invoice.id,
          amountOutstanding,
          dueDate: dueDate ?? '',
          daysOverdue,
          companyName,
        },
        language,
      );

      // Reserve BEFORE sending — see this file's own header ("Reservation, not record-after-send") for
      // why the order matters: a write failure can now only ever happen before the email goes out,
      // never silently after a real send.
      const claim = await this.claimReminderTier(companyId, invoice.id, tier);
      if (claim.status !== 'claimed') {
        // Either a concurrent pass already owns this tier (no email sent from THIS call — the
        // improvement over the old order, see header) or the reservation write itself failed for an
        // unrelated reason (no email attempted either way; retried automatically on a later pass).
        skipped++;
        continue;
      }

      try {
        // The company → instance → named refusal cascade (`MailService#sendForCompany`) — a company
        // with its own mail server sends its reminders through it, never the instance's. A named
        // refusal (no mail server configured anywhere) is caught right below exactly like any other
        // send failure: the claim is released and the reason is PERSISTED — see this file's own
        // header on why that matters for a background sweep nobody is watching interactively.
        await this.mailService.sendForCompany(companyId, {
          to: recipient,
          subject: email.subject,
          text: email.text,
        });
      } catch (error) {
        // The reservation above already exists but the email never actually went out — release it
        // (see header) so a later pass finds this tier unclaimed again, instead of leaving a phantom
        // "sent" row nobody will ever revisit. PERSISTED (not the raw Nest `this.logger` used
        // elsewhere in this file) — a reminder that silently fails to send is exactly the "no trace a
        // human can see" gap closed for the mail startup warning (see MailService's own SMTP_HOST
        // check); an admin needs to find this in Settings → Logs, not go looking through a container's
        // stdout. The sweep itself is unaffected: still counted as `skipped`, the loop still moves on
        // to the next invoice below — see this file's own header on why one invoice's failure never
        // aborts the pass.
        await this.releaseReminderClaim(claim.id, companyId, invoice.id, tier);
        logger.error(
          `Reminder sweep: failed to send the tier-${tier} reminder for invoice ${invoice.id}; its ` +
            'reservation was released so a later pass retries.',
          {
            category: 'documents',
            details: {
              companyId,
              documentId: invoice.id,
              tier,
              recipient,
              reason: error instanceof Error ? error.message : String(error),
            },
          },
        );
        skipped++;
        continue;
      }

      remindersSent++;
    }

    return { remindersSent, skipped };
  }

  /**
   * The atomic claim itself — see this file's own header ("Reservation, not record-after-send") for
   * why this runs BEFORE `mailService.sendMail`, not after. `'already-sent'` means a genuinely
   * concurrent pass raced this SAME `(documentId, tier)` pair and won (`P2002` on the
   * `@@unique([documentId, tier])` constraint, schema.prisma) — that other call's own claim already
   * owns sending this tier, so THIS call must not send it too. `'error'` means the write itself failed
   * for an unrelated reason (a transient DB hiccup): no email has been attempted either way, so there
   * is nothing to compensate, only a tier that stays unclaimed and gets retried on a later pass.
   */
  private async claimReminderTier(
    companyId: string,
    documentId: string,
    tier: number,
  ): Promise<{ status: 'claimed'; id: string } | { status: 'already-sent' } | { status: 'error' }> {
    try {
      const row = await prisma.documentReminder.create({ data: { companyId, documentId, tier } });
      return { status: 'claimed', id: row.id };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        this.logger.log(
          `Reminder sweep: tier ${tier} for document ${documentId} was already claimed by a ` +
            'concurrent pass — skipping, no email sent from this call.',
        );
        return { status: 'already-sent' };
      }
      this.logger.error(
        `Reminder sweep: could not reserve the tier-${tier} slot for document ${documentId} — ` +
          `${error instanceof Error ? error.message : String(error)}. No email was attempted; ` +
          'retried on a later pass.',
      );
      return { status: 'error' };
    }
  }

  /**
   * The compensating rollback for a claim whose email then failed to send — see this file's own header
   * for the trade-off this makes. Scoped by the claimed row's own id AND the
   * `(companyId, documentId, tier)` invariant together, the same belt-and-suspenders
   * `bank-reconciliation/persistence.ts#releaseLineClaim` holds for its own compensating rollback. If
   * this delete ITSELF fails, the claim is now stuck — this tier is durably "claimed" with no email
   * ever delivered, and no later pass will ever retry it automatically — which is exactly the residual
   * risk the header names and requires to be PERSISTED, not left to the raw Nest logger alone.
   */
  private async releaseReminderClaim(
    id: string,
    companyId: string,
    documentId: string,
    tier: number,
  ): Promise<void> {
    try {
      await prisma.documentReminder.deleteMany({ where: { id, companyId, documentId, tier } });
    } catch (error) {
      logger.error(
        `Reminder sweep: releasing the tier-${tier} reservation for document ${documentId} ALSO ` +
          'failed — this tier is now stuck as claimed without ever having been sent and will not be ' +
          'retried automatically.',
        {
          category: 'documents',
          details: {
            companyId,
            documentId,
            tier,
            reason: error instanceof Error ? error.message : String(error),
          },
        },
      );
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
 * The invoice's own client — its contact email AND its own `language`, resolved straight from
 * `data.client` (the reference field every invoice descriptor already carries) via `prisma.client`
 * DIRECTLY — never `ClientsService` (unlike `transports/email-transport.ts`'s own resolution):
 * `ReminderSweepRunner` is a leaf provider with exactly one Nest dependency (`MailService`), the same
 * "no reason to drag a whole module's worth of DI in" posture `currency-rate-sweep-runner.ts`'s own
 * header holds for staying a plain `prisma` singleton consumer — see `document-queue-worker.module.ts`'s
 * own header on why that runner needs no home in `DocumentsCoreModule` at all. Tenant-scoped
 * (`companyId` in the `where`), the same "never trust a raw id without scoping it" discipline every
 * other cross-tenant-safe query in this module already holds — a corrupted/foreign `data.client` value
 * simply resolves to `null` here, never another company's client.
 *
 * `language` is fetched alongside `contactEmail` in the SAME query (never a second round trip) — see
 * `runForCompany`'s own call site for why both are needed together: a reminder's recipient language
 * resolves from this same client row's own `Client.language`, falling back to the company's.
 */
async function resolveClientContact(
  companyId: string,
  clientIdValue: unknown,
): Promise<{ contactEmail: string | null; language: string | null } | null> {
  const clientId = typeof clientIdValue === 'string' ? clientIdValue : null;
  if (!clientId) return null;

  return prisma.client.findFirst({
    where: { id: clientId, companyId },
    select: { contactEmail: true, language: true },
  });
}
