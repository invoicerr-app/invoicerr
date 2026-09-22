import { buildInvoiceDescriptor } from '../documents/descriptors/invoice.descriptor';
import { buildQuoteDescriptor } from '../documents/descriptors/quote.descriptor';
import {
  clientVisibleStatusIds,
  directClientId,
  invoiceIdOfCreditNote,
  isPortalDocumentType,
} from './client-visibility';

describe('client-visibility', () => {
  it('derives clientVisible statuses from the descriptor, never a hardcoded list', () => {
    expect(clientVisibleStatusIds(buildInvoiceDescriptor())).toEqual(new Set(['sent']));
    expect(clientVisibleStatusIds(buildQuoteDescriptor())).toEqual(new Set(['sent', 'signed', 'refused']));
  });

  it('a descriptor with no statuses at all yields an empty set, never a throw', () => {
    expect(clientVisibleStatusIds({ id: 'x', label: 'X', fields: [], actions: [] })).toEqual(new Set());
  });

  it('isPortalDocumentType recognizes only invoice/quote/credit-note', () => {
    expect(isPortalDocumentType('invoice')).toBe(true);
    expect(isPortalDocumentType('quote')).toBe(true);
    expect(isPortalDocumentType('credit-note')).toBe(true);
    expect(isPortalDocumentType('expense')).toBe(false);
    expect(isPortalDocumentType('received-invoice')).toBe(false);
  });

  it('directClientId / invoiceIdOfCreditNote degrade to undefined on a data anomaly, never throw', () => {
    expect(directClientId({})).toBeUndefined();
    expect(directClientId({ client: 42 })).toBeUndefined();
    expect(directClientId({ client: 'c1' })).toBe('c1');
    expect(invoiceIdOfCreditNote({})).toBeUndefined();
    expect(invoiceIdOfCreditNote({ invoice: 'inv-1' })).toBe('inv-1');
  });
});
