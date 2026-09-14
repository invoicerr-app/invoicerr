import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';

import { fromMinor } from '@/utils/financial';

import { BankStatementFormat, CompanyRole } from '../../../../prisma/generated/prisma/client';
import { DocumentsService } from '../documents.service';
import { findOwnedDocument, findOwnedDocumentsByIds } from '../persistence';
import { resolveOutstandingInvoices } from './candidate-invoices';
import { CsvColumnMapping } from './csv-mapping';
import { MatchCandidateInvoice, MatchSuggestion, suggestMatches } from './matching';
import { ParsedStatementLine, parseBankStatementCsv } from './parse-csv';
import { parseBankStatementOfx } from './parse-ofx';
import {
  attachReconciledPayment,
  BankStatementLineResult,
  BankStatementResult,
  BankStatementSummary,
  claimLineForReconciliation,
  createBankStatement,
  findOwnedLine,
  findOwnedStatement,
  listBankStatements,
  listStatementLines,
  releaseLineClaim,
} from './persistence';

const VALID_DATE_FORMATS = new Set(['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY']);
const VALID_DECIMAL_SEPARATORS = new Set(['.', ',']);

/** Every field of `CsvColumnMapping` a scripted client could get wrong — checked EXPLICITLY, never
 *  left to fall through to a silent default: an unrecognized `dateFormat` must be a NAMED 400, not a
 *  guessed interpretation of the human's own dates (this module's own "never guess" posture,
 *  `parse-csv.ts`'s own header). */
function assertValidMapping(mapping: CsvColumnMapping): void {
  if (!mapping.dateColumn || !mapping.amountColumn || !mapping.labelColumn) {
    throw new BadRequestException(
      'dateColumn, amountColumn and labelColumn are all required in the mapping.',
    );
  }
  if (!VALID_DATE_FORMATS.has(mapping.dateFormat)) {
    throw new BadRequestException(`Unrecognized dateFormat "${mapping.dateFormat}".`);
  }
  if (!VALID_DECIMAL_SEPARATORS.has(mapping.decimalSeparator)) {
    throw new BadRequestException(`Unrecognized decimalSeparator "${mapping.decimalSeparator}".`);
  }
}

/** OFX by extension (`.ofx`/`.qfx`) or, failing that, by the presence of the OFX root tag — an
 *  objective fact about the BYTES, never a guess about their meaning (the same "mechanical signature,
 *  not a semantic inference" posture `received-invoices/ocr/apply-ocr-fallback.ts`'s own `looksLikePdf`
 *  already holds). Everything else is CSV — the only other format this feature reads. */
function detectStatementFormat(fileName: string, text: string): BankStatementFormat {
  if (/\.(ofx|qfx)$/i.test(fileName)) return BankStatementFormat.OFX;
  if (/\.csv$/i.test(fileName)) return BankStatementFormat.CSV;
  return /<OFX>/i.test(text) ? BankStatementFormat.OFX : BankStatementFormat.CSV;
}

export interface ImportBankStatementResult {
  statement: BankStatementResult;
  /** Rows the parser could not read (a blank cell, an unparseable date/amount) — see `parse-csv.ts`'s
   *  own `CsvParseResult.errors` header: the import still SUCCEEDS for every other row, this is
   *  surfaced so the human knows some lines from the source file are missing and why. */
  errors: string[];
}

export interface StatementLineWithSuggestions {
  line: BankStatementLineResult;
  suggestions: MatchSuggestion[];
  /** The RECONCILED invoice's own `displayNumber` (falling back to its raw id) — a screen showing a
   *  reconciled row should never make the human cross-reference `reconciledDocumentId` by hand. `null`
   *  for an UNMATCHED line, or when the invoice this once pointed to no longer exists. */
  reconciledInvoiceLabel: string | null;
}

export interface StatementLinesView {
  statement: BankStatementResult;
  /** Every outstanding invoice in the statement's OWN currency — what a manual match's own picker
   *  offers, in addition to whatever `suggestions` a given line already carries. */
  candidates: MatchCandidateInvoice[];
  lines: StatementLineWithSuggestions[];
}

/**
 * TODO_FEATURES.md rank 5 ("rapprochement bancaire par import de relevé"). Controller -> Service ->
 * Prisma, same as every other module here — but `reconcileLine` below is the ONE place this service
 * does NOT reach `DocumentPayment` directly: it calls `DocumentsService.runAction('invoice',
 * 'record-payment', …)`, the exact SAME action a hand-entered payment goes through
 * (`documents.controller.ts`'s own generic action route). This is deliberate, not an oversight — see
 * `settlement/payments.ts`'s own header ("a payment is never UPDATED or DELETED by anything in this
 * module") and this feature's own brief: "a reconciled bank line must produce EXACTLY the same payment
 * a hand-entered one produces... or the two paths will drift". Going through the real action, rather
 * than calling `settlement/payments.ts#recordPayment` directly, is what also gets the currency
 * conversion guard, the country-policy/status gates, the `DOCUMENT_SETTLED` webhook, and the settlement
 * log line for free — a second, narrower write path would have to reimplement every one of those, and
 * WOULD eventually disagree with the real one about at least one of them.
 */
@Injectable()
export class BankReconciliationService {
  constructor(private readonly documentsService: DocumentsService) {}

  async importStatement(
    companyId: string,
    fileName: string,
    base64: string,
    currency: string,
    mapping?: CsvColumnMapping,
  ): Promise<ImportBankStatementResult> {
    const text = Buffer.from(base64, 'base64').toString('utf-8');
    const format = detectStatementFormat(fileName, text);

    let parsed: { lines: ParsedStatementLine[]; errors: string[] };
    try {
      if (format === BankStatementFormat.OFX) {
        parsed = parseBankStatementOfx(text, currency);
      } else {
        if (!mapping) {
          throw new BadRequestException('A column mapping is required to import a CSV statement.');
        }
        assertValidMapping(mapping);
        parsed = parseBankStatementCsv(text, mapping, currency);
      }
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(error instanceof Error ? error.message : 'Could not parse this file.');
    }

    if (parsed.lines.length === 0 && parsed.errors.length === 0) {
      throw new BadRequestException('The file carries no transaction lines.');
    }

    const statement = await createBankStatement(companyId, fileName, format, currency, parsed.lines);
    return { statement, errors: parsed.errors };
  }

  listStatements(companyId: string): Promise<BankStatementSummary[]> {
    return listBankStatements(companyId);
  }

  /**
   * A statement's own lines, each carrying its live suggestions — computed FRESH on every read, never
   * stored (an invoice's own outstanding balance can change between two reads of the same statement:
   * a suggestion is a PROJECTION, exactly like `settlement/compute-settlement.ts`'s own balance, never
   * a fact this module writes down ahead of time). Only an UNMATCHED line is ever offered suggestions
   * — a RECONCILED one already has its own answer (`reconciledDocumentId`), so recomputing candidates
   * for it would be pure waste.
   */
  async getStatementLines(companyId: string, statementId: string): Promise<StatementLinesView> {
    const statement = await findOwnedStatement(companyId, statementId);
    const lines = await listStatementLines(companyId, statementId);
    const allCandidates = await resolveOutstandingInvoices(companyId);
    const candidates = allCandidates.filter((candidate) => candidate.currency === statement.currency);

    // One batched, EXACT-id lookup for every RECONCILED line's own invoice — the same
    // `findOwnedDocumentsByIds` shape `accounting-export.service.ts` already uses to resolve a
    // payment row's own invoice: an invoice a line was reconciled against can, by the time this reads,
    // be fully settled (and so absent from `candidates` above, which only lists OUTSTANDING ones), so
    // `candidates` itself is never a reliable source for this label.
    const reconciledIds = lines
      .map((line) => line.reconciledDocumentId)
      .filter((id): id is string => id !== null);
    const reconciledDocuments = await findOwnedDocumentsByIds(companyId, reconciledIds);
    const reconciledLabelsById = new Map(
      reconciledDocuments.map((document) => [document.id, document.displayNumber ?? document.id]),
    );

    const linesWithSuggestions: StatementLineWithSuggestions[] = lines.map((line) => ({
      line,
      suggestions:
        line.status === 'UNMATCHED'
          ? suggestMatches(
              {
                amountMinor: line.amountMinor,
                currency: statement.currency,
                date: line.date,
                label: line.label,
                reference: line.reference,
              },
              candidates,
            )
          : [],
      reconciledInvoiceLabel: line.reconciledDocumentId
        ? (reconciledLabelsById.get(line.reconciledDocumentId) ?? null)
        : null,
    }));

    return {
      statement: { ...statement, lineCount: lines.length },
      candidates,
      lines: linesWithSuggestions,
    };
  }

  /**
   * Confirms ONE match: a bank line + an invoice the human picked (from `suggestions` or from the
   * broader `candidates` list) becomes exactly one `DocumentPayment`, through
   * `DocumentsService.runAction` — see this class's own header.
   *
   * The sequence, and why the ORDER matters:
   *  1. `claimLineForReconciliation` — an ATOMIC, conditional `UPDATE ... WHERE status = 'UNMATCHED'`
   *     (persistence.ts's own header explains the race it closes). Runs BEFORE the payment exists:
   *     claiming FIRST is what makes a lost race refuse cleanly with NO payment ever created, rather
   *     than risking two concurrent requests each creating one for the same line.
   *  2. Only once claimed: call "record-payment" through the REAL action. `paidAt` is the LINE's own
   *     date (the day the money actually arrived, per the bank) — never "now", the same "a payment
   *     converts/settles as of when the money arrived, not when someone got around to recording it"
   *     discipline `settlement/convert-payment.ts` already holds. `method: 'bank_transfer'` — this
   *     payment did, in fact, arrive by bank transfer (a reconciled statement line IS that channel);
   *     `note` names the line's own label, so a later reader of the invoice's payment list can see
   *     which bank transaction produced this row without cross-referencing the statement.
   *  3. `attachReconciledPayment` — records WHICH payment resulted, read straight off
   *     `ActionResult.createdPaymentId` (see that field's own header in `action-registry.ts`). This
   *     USED TO be resolved by diffing `listPayments` before/after the action ran — which broke the
   *     moment two statement lines were reconciled against the SAME invoice with the two calls
   *     interleaved (two staff working a queue, or an invoice paid in two instalments arriving as two
   *     lines): both diffs could pick up the OTHER call's new row, so `reconciledPaymentId` could end
   *     up naming the wrong bank transaction even though the money itself always posted correctly
   *     (each call still posts its OWN line's own amount). Reading the id the handler already has
   *     removes the race entirely — see this file's own spec's interleaved-reconciliation test.
   *  4. If step 2 or 3 THROWS (a currency-conversion refusal, a country-policy block, a status
   *     conflict…), `releaseLineClaim` UNDOES step 1's claim — a failed reconciliation must leave the
   *     line exactly as it was, ready to be retried, never stuck "reconciled" with nothing to show
   *     for it.
   */
  async reconcileLine(
    companyId: string,
    lineId: string,
    documentId: string,
    role?: CompanyRole,
  ): Promise<BankStatementLineResult> {
    const line = await findOwnedLine(companyId, lineId);
    if (line.status === 'RECONCILED') {
      throw new ConflictException(`Bank statement line "${lineId}" has already been reconciled.`);
    }
    if (line.amountMinor <= 0) {
      throw new BadRequestException('Only a credit (money-in) line can be reconciled against an invoice.');
    }

    const claimed = await claimLineForReconciliation(companyId, lineId, documentId);
    if (!claimed) {
      // Lost a genuine race against a concurrent request — see this method's own header. Identical,
      // honest 409 to the fast-path check above: from the caller's point of view both mean the same
      // thing, "this line is already reconciled".
      throw new ConflictException(`Bank statement line "${lineId}" has already been reconciled.`);
    }

    const statement = await findOwnedStatement(companyId, line.statementId);

    try {
      // `runAction` validates `payload.data` against the invoice's OWN required fields for EVERY
      // action, "record-payment" included, even though this action never reads or writes `data` at
      // all (see invoice-actions.ts's own handler) — the exact same "re-submit the record's current
      // data unchanged" shape the real screen's own action dialog already sends for any action run on
      // an EXISTING document (documents.controller.ts's generic route has no notion of "this action
      // doesn't need data"). An unknown/foreign `documentId` 404s here, before any claim is touched.
      const document = await findOwnedDocument(companyId, 'invoice', documentId);

      const result = await this.documentsService.runAction(
        companyId,
        'invoice',
        'record-payment',
        {
          documentId,
          data: (document.data ?? {}) as Record<string, unknown>,
          params: {
            amount: fromMinor(line.amountMinor, statement.currency),
            currency: statement.currency,
            paidAt: line.date.toISOString(),
            method: 'bank_transfer',
            note: `Bank reconciliation: ${line.label}`.trim(),
          },
        },
        role,
      );

      const paymentId = result.createdPaymentId;
      if (!paymentId) {
        // Unreachable in practice — "record-payment" always returns the id of the payment it just
        // inserted on success (see invoice-actions.ts / ActionResult.createdPaymentId) — but never
        // trusted alone, the same defensive posture this whole module's own actions hold for every
        // "should never happen" case.
        throw new Error('"record-payment" ran but returned no createdPaymentId.');
      }

      await attachReconciledPayment(companyId, lineId, paymentId);
      return {
        ...line,
        status: 'RECONCILED',
        reconciledDocumentId: documentId,
        reconciledPaymentId: paymentId,
        reconciledAt: new Date(),
      };
    } catch (error) {
      await releaseLineClaim(companyId, lineId);
      throw error;
    }
  }
}
