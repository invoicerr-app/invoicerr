import { toMinor } from '@/utils/financial';
import { MAX_STATEMENT_AMOUNT_MINOR } from './parse-csv';

import { ParsedStatementLine } from './parse-csv';

/**
 * Reads an OFX bank statement into the SAME `ParsedStatementLine[]` shape `parse-csv.ts` produces —
 * the two formats converge on one shape the moment parsing is done, so `bank-reconciliation.service.ts`
 * never has to know which one a given statement came from.
 *
 * Needs NO per-import mapping, unlike CSV (see `parse-csv.ts`'s own header for the full "why a
 * mapping, not sniffing" reasoning) — OFX is a SELF-DESCRIBING, tagged format: `<DTPOSTED>`/
 * `<TRNAMT>`/`<MEMO>`/`<NAME>`/`<FITID>` name themselves, so there is nothing here for a human to map.
 * This is "OFX, if it comes cheaply" made real: a small tag extractor over the one repeating
 * `<STMTTRN>` block every real statement export actually contains, never a spec-complete OFX parser
 * (no `<BANKMSGSRSV1>` traversal, no account/currency-block validation).
 *
 * Handles BOTH OFX dialects with one extractor: OFX 1.x (SGML — a leaf tag has no closing tag, its
 * value runs to the next `<` or line break) and OFX 2.x (real, closed XML tags). `extractOfxTag` tries
 * the closed-tag form first and falls back to the unclosed SGML form — a real-world export is
 * consistently one dialect or the other, never a mix, so trying both costs nothing and locks out
 * neither.
 */

function extractOfxTag(block: string, tag: string): string | null {
  const closed = new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i').exec(block);
  if (closed) return closed[1].trim();
  const open = new RegExp(`<${tag}>([^<\r\n]*)`, 'i').exec(block);
  return open ? open[1].trim() : null;
}

/** OFX's own `DTPOSTED` — always `YYYYMMDD`, optionally followed by a time and/or timezone
 *  (`20260815120000[+1:CET]`) this function ignores: only the CALENDAR DAY matters here (matching.ts's
 *  own date-window check works in whole days), resolved at UTC midnight — the same discipline
 *  `parse-csv.ts`'s own `parseCsvDate` holds. */
function parseOfxDate(raw: string): Date | null {
  const match = /^(\d{4})(\d{2})(\d{2})/.exec(raw);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(date.getTime()) || date.getUTCMonth() !== month - 1 ? null : date;
}

export interface OfxParseResult {
  lines: ParsedStatementLine[];
  /** One entry per transaction block this extractor could not read (missing DTPOSTED/TRNAMT, or an
   *  unparseable one) — same "named, never silent" posture `parse-csv.ts`'s own `errors` holds. */
  errors: string[];
}

export function parseBankStatementOfx(text: string, currency: string): OfxParseResult {
  const blocks = text.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) ?? [];
  const lines: ParsedStatementLine[] = [];
  const errors: string[] = [];

  blocks.forEach((block, index) => {
    const position = index + 1;
    const dtposted = extractOfxTag(block, 'DTPOSTED');
    const trnamt = extractOfxTag(block, 'TRNAMT');
    if (!dtposted || !trnamt) {
      errors.push(`Transaction ${position}: missing DTPOSTED or TRNAMT`);
      return;
    }

    const date = parseOfxDate(dtposted);
    if (!date) {
      errors.push(`Transaction ${position}: "${dtposted}" is not a valid DTPOSTED date`);
      return;
    }

    // OFX's own spec mandates a plain period as the decimal mark and no thousands separator — no
    // locale ambiguity to resolve here, unlike a CSV's own human-supplied `decimalSeparator`.
    const amountMajor = Number(trnamt);
    if (!Number.isFinite(amountMajor)) {
      errors.push(`Transaction ${position}: "${trnamt}" is not a valid TRNAMT amount`);
      return;
    }

    // Same bound as the CSV parser, for the same reason: `amountMinor` is a Postgres `Int`, and a
    // value past it must be refused here, where the row is still skippable, rather than at the INSERT
    // where it would take the whole import with it. See MAX_STATEMENT_AMOUNT_MINOR's own comment.
    const amountMinor = toMinor(amountMajor, currency);
    if (Math.abs(amountMinor) > MAX_STATEMENT_AMOUNT_MINOR) {
      errors.push(`Transaction ${position}: "${trnamt}" is out of the range a statement line can hold`);
      return;
    }

    const memo = extractOfxTag(block, 'MEMO');
    const name = extractOfxTag(block, 'NAME');
    const fitid = extractOfxTag(block, 'FITID');

    lines.push({
      date,
      amountMinor,
      // MEMO over NAME when both are present — MEMO is the free-text note a payer actually typed
      // (the one place an invoice number is likely to appear), NAME is closer to a fixed payee label.
      label: memo || name || '',
      reference: fitid || null,
      raw: {
        DTPOSTED: dtposted,
        TRNAMT: trnamt,
        ...(memo ? { MEMO: memo } : {}),
        ...(name ? { NAME: name } : {}),
        ...(fitid ? { FITID: fitid } : {}),
      },
    });
  });

  return { lines, errors };
}
