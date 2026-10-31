/**
 * Pre-fills the import form from the original file a previous tool produced (issue #758): a
 * Factur-X PDF, or a bare CII or UBL XML. This module owns the DECISIONS the reader must not make
 * for the user - which client a buyer party is, whether the totals actually add up, what is missing
 * and must be typed by hand - and never a second XML parser: every fact comes from
 * `received-invoices/extraction.ts#extractImportFields`, the same reader the received-invoice
 * upload screen already uses.
 *
 * Three refusals are deliberate and loud, because guessing would create a false legal archive:
 *  - the file is not a recognized structured invoice at all;
 *  - its own totals do not add up (header net + VAT != gross, or the lines do not sum to the header
 *    net / VAT);
 *  - a line states a net amount its quantity x unit price cannot represent (a line-level charge,
 *    which the import form has no field for).
 * Everything else that is merely ABSENT (a due date, the lines of a MINIMUM profile, a buyer that
 * matches no client) becomes a warning and an empty field for the human to fill, never an invented
 * value.
 */
import { BadRequestException } from '@nestjs/common';

import { guessCountryCode } from '@/utils/country-name-to-iso';

import {
  DocumentExtractionResult,
  ExtractedDocumentFields,
  extractImportFields,
} from '../received-invoices/extraction';
import { matchBuyerClient } from './client-match';
import {
  ImportableTypeId,
  ImportClientMatch,
  ImportClientProposal,
  ImportPrefillResult,
  ImportPrefillTotals,
} from './document-import.types';

/** Two cents: the smallest amount a real invoice can differ by after per-line and per-rate
 *  rounding. Anything wider than this is not rounding, it is a different total. */
const TOTAL_TOLERANCE = 0.02;

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function toleranceFor(itemCount: number): number {
  return Math.max(TOTAL_TOLERANCE, 0.01 * itemCount);
}

function refuse(message: string): never {
  throw new BadRequestException(message);
}

export interface PrefillDraft {
  syntax: 'CII' | 'UBL' | 'FACTURX_CII';
  originalNumber: string;
  fields: Record<string, unknown>;
  totals: ImportPrefillTotals;
  warnings: string[];
  buyer: { name?: string; vatId?: string };
  clientProposal?: ImportClientProposal;
}

interface BuiltLines {
  lines: Record<string, unknown>[];
  net: number;
  vat: number;
}

/**
 * Turns the file's BG-25 lines into the import form's own line shape. `discountPercent` is derived
 * only when the producer's own stated line net (BT-131) differs from quantity x unit price: that
 * difference is a line-level allowance, and the form's only way to keep the totals identical is its
 * discount column. A NEGATIVE difference (a line-level charge) has no field here, so it is refused
 * rather than silently dropped.
 */
function buildLines(fields: ExtractedDocumentFields): BuiltLines {
  const sourceLines = fields.lines ?? [];
  const lines: Record<string, unknown>[] = [];
  const netByRate = new Map<string, number>();

  sourceLines.forEach((line, index) => {
    const position = index + 1;
    const description = line.description?.trim();
    if (!description) refuse(`Line ${position} of this file has no designation, so it cannot be imported.`);
    if (line.quantity === undefined) {
      refuse(`Line ${position} ("${description}") has no quantity, so it cannot be imported.`);
    }
    if (line.unitPrice === undefined) {
      refuse(`Line ${position} ("${description}") has no unit price, so it cannot be imported.`);
    }
    const vatRate = line.vatRate?.trim();
    if (!vatRate) {
      refuse(`Line ${position} ("${description}") has no VAT rate, so it cannot be imported.`);
    }

    const gross = line.quantity * line.unitPrice;
    let discountPercent: number | undefined;
    if (line.netAmount !== undefined) {
      if (line.netAmount > gross + TOTAL_TOLERANCE) {
        refuse(
          `Line ${position} ("${description}") states a net amount higher than its quantity x unit ` +
            'price. The import form has no line-level charge field, so this file cannot be imported ' +
            'without losing money.',
        );
      }
      if (gross > 0) {
        const discount = roundMoney((1 - line.netAmount / gross) * 100);
        if (discount > 0) discountPercent = discount;
      }
    }

    const net = roundMoney(gross * (1 - (discountPercent ?? 0) / 100));
    netByRate.set(vatRate, roundMoney((netByRate.get(vatRate) ?? 0) + net));
    lines.push({
      description,
      quantity: line.quantity,
      ...(line.unit ? { unit: line.unit } : {}),
      unitPrice: line.unitPrice,
      vatRate,
      ...(discountPercent !== undefined ? { discountPercent } : {}),
    });
  });

  let net = 0;
  let vat = 0;
  for (const [rate, basis] of netByRate) {
    const parsedRate = Number(rate.replace(',', '.'));
    net = roundMoney(net + basis);
    if (Number.isFinite(parsedRate)) vat = roundMoney(vat + roundMoney((basis * parsedRate) / 100));
  }

  return { lines, net, vat };
}

/**
 * The pure half: every refusal and every derived field, with no database read. Split out so the
 * import pre-fill's arithmetic can be proven against real provider output without a Postgres.
 */
export function buildPrefillDraft(
  typeId: ImportableTypeId,
  extraction: DocumentExtractionResult,
): PrefillDraft {
  if (extraction.syntax === null) {
    refuse(
      'This file is not a recognized Factur-X, CII or UBL invoice. Only a structured e-invoice can ' +
        'pre-fill the import form; attach it as the original and type the rest by hand.',
    );
  }

  const fields = extraction.fields;
  if (fields.documentType && fields.documentType !== typeId) {
    const actual = fields.documentType === 'credit-note' ? 'credit note' : 'invoice';
    const wanted = typeId === 'credit-note' ? 'credit note' : 'invoice';
    const article = actual === 'invoice' ? 'an' : 'a';
    const wantedArticle = wanted === 'invoice' ? 'an' : 'a';
    refuse(
      `This file is ${article} ${actual}, but you are importing ${wantedArticle} ${wanted}. ` +
        `Open the ${actual} import instead.`,
    );
  }

  const originalNumber = fields.supplierNumber?.trim();
  if (!originalNumber) refuse('This file has no document number, so it cannot be imported.');
  if (!fields.issueDate) refuse('This file has no issue date, so it cannot be imported.');
  if (!fields.currency) refuse('This file has no currency, so it cannot be imported.');

  const { netAmount, vatAmount, grossAmount } = fields;
  if (netAmount === undefined || vatAmount === undefined || grossAmount === undefined) {
    refuse('This file does not state its net, VAT and gross totals, so it cannot be imported.');
  }
  if (Math.abs(netAmount + vatAmount - grossAmount) > TOTAL_TOLERANCE) {
    refuse(
      `This file's totals do not add up: net ${netAmount} + VAT ${vatAmount} != gross ${grossAmount}. ` +
        'Refusing to import a document whose own arithmetic is inconsistent.',
    );
  }

  if (fields.taxBreakdown && fields.taxBreakdown.length > 0) {
    const statedTax = roundMoney(fields.taxBreakdown.reduce((sum, subtotal) => sum + subtotal.tax, 0));
    if (Math.abs(statedTax - vatAmount) > toleranceFor(fields.taxBreakdown.length)) {
      refuse(
        `This file's tax subtotals add up to ${statedTax}, but its VAT total says ${vatAmount}. ` +
          'Refusing to import a document whose own arithmetic is inconsistent.',
      );
    }
  }

  const built = buildLines(fields);
  if (built.lines.length > 0) {
    if (Math.abs(built.net - netAmount) > toleranceFor(built.lines.length)) {
      refuse(
        `This file's lines add up to ${built.net} net, but its stated net total is ${netAmount}. ` +
          'A document-level allowance or charge is probably not represented; refusing to guess.',
      );
    }
    if (Math.abs(built.vat - vatAmount) > toleranceFor(built.lines.length)) {
      refuse(
        `This file's lines produce ${built.vat} of VAT, but its stated VAT total is ${vatAmount}. ` +
          'Refusing to guess which rate is right.',
      );
    }
  }

  const warnings: string[] = [];
  if (!fields.documentType) {
    warnings.push(
      `The file does not state whether it is an invoice or a credit note; it is imported as a ${typeId}.`,
    );
  }
  if (built.lines.length === 0) {
    warnings.push(
      'This file carries no invoice lines (a MINIMUM Factur-X profile does not). Add them before confirming.',
    );
  }
  if (typeId === 'invoice' && !fields.dueDate) {
    warnings.push('This file has no due date. Fill it in before confirming.');
  }
  if (typeId === 'credit-note') {
    warnings.push(
      'An imported credit note is free (not linked to an invoice), so it needs a reason. Fill one in before confirming.',
    );
  }

  const data: Record<string, unknown> =
    typeId === 'invoice'
      ? {
          issueDate: fields.issueDate,
          ...(fields.dueDate ? { dueDate: fields.dueDate } : {}),
          currency: fields.currency,
          ...(fields.notes ? { notes: fields.notes } : {}),
          ...(fields.buyerReference ? { clientReference: fields.buyerReference } : {}),
          lines: built.lines,
        }
      : {
          issueDate: fields.issueDate,
          currency: fields.currency,
          ...(fields.notes ? { notes: fields.notes } : {}),
          lines: built.lines,
        };

  const proposalCountryCode = fields.buyerCountry ? guessCountryCode(fields.buyerCountry) : undefined;
  const proposalCountryName =
    proposalCountryCode && fields.buyerCountry
      ? (new Intl.DisplayNames(['en'], { type: 'region' }).of(proposalCountryCode) ?? fields.buyerCountry)
      : fields.buyerCountry;
  const clientProposal: ImportClientProposal | undefined = fields.buyer
    ? {
        name: fields.buyer,
        ...(fields.buyerVatId ? { vatId: fields.buyerVatId } : {}),
        ...(fields.buyerAddress ? { address: fields.buyerAddress } : {}),
        ...(fields.buyerCity ? { city: fields.buyerCity } : {}),
        ...(fields.buyerPostalCode ? { postalCode: fields.buyerPostalCode } : {}),
        ...(proposalCountryName ? { country: proposalCountryName } : {}),
        ...(proposalCountryCode ? { countryCode: proposalCountryCode } : {}),
        ...(fields.buyerEmail ? { email: fields.buyerEmail } : {}),
        currency: fields.currency,
      }
    : undefined;

  return {
    syntax: extraction.syntax,
    originalNumber,
    fields: data,
    totals: {
      net: netAmount,
      vat: vatAmount,
      gross: grossAmount,
      ...(built.lines.length > 0 ? { linesNet: built.net, linesVat: built.vat } : {}),
    },
    warnings,
    buyer: { name: fields.buyer, vatId: fields.buyerVatId },
    clientProposal,
  };
}

/**
 * The full pre-fill: reads the file, refuses what cannot be imported honestly, matches the buyer
 * against this company's clients, and returns the form data. The caller (`DocumentImportService`)
 * has already resolved the file's bytes from the tenant-scoped attachment store.
 */
export async function buildImportPrefill(
  companyId: string,
  typeId: ImportableTypeId,
  bytes: Uint8Array,
  mime: string,
  fileName: string,
): Promise<ImportPrefillResult> {
  const extraction = await extractImportFields(bytes, mime, fileName);
  const draft = buildPrefillDraft(typeId, extraction);

  const clientMatch: ImportClientMatch = await matchBuyerClient(companyId, draft.buyer);
  if (clientMatch.outcome === 'matched' && typeId === 'invoice') {
    draft.fields.client = clientMatch.clientId;
  }
  if (clientMatch.outcome === 'unmatched') {
    draft.warnings.push(
      draft.clientProposal
        ? `No existing client matches "${draft.clientProposal.name}". Create it, or pick another client.`
        : 'This file has no buyer name, so no client could be matched. Pick a client by hand.',
    );
  } else if (clientMatch.outcome === 'ambiguous') {
    draft.warnings.push(
      `More than one client matches this buyer's ${clientMatch.matchedBy === 'vat' ? 'VAT number' : 'name'}. ` +
        'Pick the right one by hand.',
    );
  }

  return {
    typeId,
    syntax: draft.syntax,
    originalNumber: draft.originalNumber,
    fields: draft.fields,
    clientMatch,
    ...(draft.clientProposal ? { clientProposal: draft.clientProposal } : {}),
    totals: draft.totals,
    warnings: draft.warnings,
  };
}
