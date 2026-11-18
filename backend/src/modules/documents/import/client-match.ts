/**
 * Matches the BUYER party of a structured import file against this company's own client book
 * (issue #758). Runs the same rule as `received-invoices/supplier-reconciliation.ts`, for the
 * opposite side of the document: VAT first, exact name as the fallback, an ambiguous hit named as
 * such rather than silently resolved. The rule itself lives in `../client-book-match.ts`; this
 * wrapper exists so neither caller has to know about the other's party role.
 */
import { matchClientByVatThenName } from '../client-book-match';
import { ImportClientMatch } from './document-import.types';

export interface BuyerMatchCriteria {
  vatId?: string;
  name?: string;
}

export async function matchBuyerClient(
  companyId: string,
  criteria: BuyerMatchCriteria,
): Promise<ImportClientMatch> {
  return matchClientByVatThenName(companyId, criteria);
}
