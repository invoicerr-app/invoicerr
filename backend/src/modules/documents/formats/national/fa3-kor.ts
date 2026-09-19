/**
 * Resolves the KOR (faktura korygująca — Poland's post-clearance correction) context `fa3-provider.ts`
 * needs to build a `RodzajFaktury = KOR` document: the ORIGINAL invoice's own displayNumber/issueDate,
 * plus — where it applies — its authoritative KSeF number. REPRISED, and ADAPTED, from
 * `invoice-rendering/national/fa-vat.ts` at git tag `avant-refonte-documents` (see that file's own
 * `DaneFaKorygowanej` block); adapted because that engine read a `correction` object off its own
 * per-document `InvoiceRenderData`, which this branch's generic document model has no equivalent of —
 * here the ORIGINAL invoice is looked up fresh, by id, the same way `credit-note-actions.ts`'s own
 * `assertCreditNoteCurrencyMatchesInvoice` re-reads the invoice a credit note references.
 *
 * ## The KSeF-number choice — verified against the RAW statute, not assumed
 *
 * `schemat_FA3.xsd`'s own `DaneFaKorygowanej` declares an `xsd:choice`: either the corrected invoice's
 * KSeF number (`NrKSeF` + `NrKSeFFaKorygowanej`), or `NrKSeFN` — "the corrected invoice was issued
 * OUTSIDE KSeF" — never neither. Art. 106j ust. 2 pkt 2a ustawy o VAT (tekst jednolity Dz.U. 2025 poz.
 * 775, isap.sejm.gov.pl, checked 2026-09-16) makes the FIRST branch mandatory ONLY "z wyjątkiem faktur
 * korygujących wystawianych do faktur, dla których nie został nadany numer identyfikujący w Krajowym
 * Systemie e-Faktur" — "EXCEPT for corrective invoices issued for invoices which were NOT assigned an
 * identifying number in KSeF" — a real, statutory exception, not a gap this code invented. And KSeF
 * itself is only `requirement: 'suggested'` for Poland today (`transports/channel-policy/data/pl.json`
 * — that file's own header: arming it as `mandated` today "WOULD REFUSE invoices that are still
 * perfectly lawful"), so an original invoice legitimately sent by "email" (or any other channel) and
 * carrying no KSeF number at all is a real, LAWFUL case, not a data-quality bug to refuse.
 *
 * So this resolver branches on the ORIGINAL's own `channelProviderId` (`DocumentInstance` — see that
 * column's own schema comment):
 *  - `'ksef'` — the original WAS submitted through KSeF. Its `ksefNumber` is only ever persisted once
 *    the post-deposit conformity sweep observes a real CLEARED verdict (`ksef-transport.ts`'s own
 *    header: `send()` itself only returns a session/invoice REFERENCE, never the final number) — if
 *    none is on file yet, this is "still processing, not yet cleared", and building a KOR now would
 *    either lie (claim `NrKSeFN`, "issued outside KSeF", for an invoice that WAS submitted to it) or
 *    submit an incomplete mandatory element — refused instead, naming exactly what to wait for.
 *  - anything else (a different channel, or never sent through a transport that reports one at all) —
 *    the statutory exception applies outright: `NrKSeFN`, no number to wait for, ever.
 */
import { BadRequestException } from '@nestjs/common';

import { listAuthorityEvents } from '../../conformity/authority-events.persistence';
import { findOwnedDocument } from '../../persistence';
import type { InvoiceStatusResponse } from '../../transports/ksef/ksef-client';

export interface FaVatKorContext {
  originalDisplayNumber: string;
  /** ISO date (YYYY-MM-DD) — `DataWystFaKorygowanej`. */
  originalIssueDate: string;
  /** Set only when the original was genuinely submitted through KSeF and its `ksefNumber` has been
   *  observed CLEARED — `undefined` means the FA(3) builder must use the schema's own `NrKSeFN`
   *  branch instead (see this file's own header). */
  originalKsefNumber?: string;
}

const KSEF_PROVIDER_ID = 'ksef';

/** The original invoice's own `ksefNumber`, read back from its journaled `DocumentAuthorityEvent`
 *  rows (providerId "ksef") — the ONLY place a post-deposit `ksefNumber` is ever persisted in this
 *  codebase (see this file's own header). `listAuthorityEvents` already orders most-recent-first; an
 *  early poll can legitimately precede clearance (still processing, no number yet) while a later one
 *  already carries it, so this returns the first non-empty one it finds, not merely the latest row. */
async function resolveObservedKsefNumber(companyId: string, documentId: string): Promise<string | undefined> {
  const events = await listAuthorityEvents(companyId, documentId);
  for (const event of events) {
    if (event.providerId !== KSEF_PROVIDER_ID) continue;
    const payload = event.rawPayload as InvoiceStatusResponse | null;
    const ksefNumber = payload?.ksefNumber;
    if (typeof ksefNumber === 'string' && ksefNumber.trim()) return ksefNumber;
  }
  return undefined;
}

export async function resolveFaVatKorContext(
  companyId: string,
  correctsInvoiceId: string,
): Promise<FaVatKorContext> {
  const original = await findOwnedDocument(companyId, 'invoice', correctsInvoiceId);
  const originalData = (original.data ?? {}) as Record<string, unknown>;
  const originalIssueDate =
    typeof originalData.issueDate === 'string' ? originalData.issueDate.slice(0, 10) : undefined;

  if (!original.displayNumber || !originalIssueDate) {
    throw new BadRequestException(
      `Cannot build a Polish faktura korygująca (KOR): the corrected invoice "${correctsInvoiceId}" ` +
        'has no number/issue date of its own yet — it must be ISSUED before it can be corrected.',
    );
  }

  if (original.channelProviderId !== KSEF_PROVIDER_ID) {
    // Never submitted to KSeF at all — the statutory exception (art. 106j ust. 2 pkt 2a) applies
    // outright, no number to wait for.
    return { originalDisplayNumber: original.displayNumber, originalIssueDate };
  }

  const originalKsefNumber = await resolveObservedKsefNumber(companyId, correctsInvoiceId);
  if (!originalKsefNumber) {
    throw new BadRequestException(
      `Cannot build a Polish faktura korygująca (KOR) yet: the corrected invoice ` +
        `"${original.displayNumber}" was submitted through KSeF, but no CLEARED verdict (carrying its ` +
        'own KSeF number) has been observed yet by the post-deposit conformity sweep. Art. 106j ust. 2 ' +
        "pkt 2a ustawy o VAT makes the corrected invoice's own KSeF number a mandatory element of the " +
        'correction whenever one was submitted through KSeF — wait for clearance, then correct it.',
    );
  }

  return { originalDisplayNumber: original.displayNumber, originalIssueDate, originalKsefNumber };
}
