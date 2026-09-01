import {
  canReadDocumentType,
  canWriteDocumentType,
  DOCUMENT_READ_SCOPES,
  DOCUMENT_WRITE_SCOPES,
  hasAnyScope,
  scopeForDocumentType,
} from './scope-mapping';

describe('scope-mapping', () => {
  it('computes the pluralised scope for every shipped document type', () => {
    expect(scopeForDocumentType('quote', 'read')).toBe('quotes:read');
    expect(scopeForDocumentType('quote', 'write')).toBe('quotes:write');
    expect(scopeForDocumentType('invoice', 'write')).toBe('invoices:write');
    expect(scopeForDocumentType('credit-note', 'write')).toBe('credit-notes:write');
    expect(scopeForDocumentType('expense', 'read')).toBe('expenses:read');
    expect(scopeForDocumentType('received-invoice', 'write')).toBe('received-invoices:write');
  });

  it('fails CLOSED for a typeId whose computed scope is not a declared ApiKeyScope', () => {
    expect(scopeForDocumentType('some-plugin-type', 'read')).toBeUndefined();
  });

  it('never includes the entity scopes (clients/articles) among the document scope sets', () => {
    expect(DOCUMENT_READ_SCOPES).not.toContain('clients:read');
    expect(DOCUMENT_READ_SCOPES).not.toContain('articles:read');
    expect(DOCUMENT_WRITE_SCOPES).not.toContain('clients:write');
    expect(DOCUMENT_WRITE_SCOPES).not.toContain('articles:write');
  });

  it('hasAnyScope is true whenever at least one candidate is granted', () => {
    expect(hasAnyScope(['quotes:read', 'invoices:read'], ['invoices:read'])).toBe(true);
    expect(hasAnyScope(['quotes:read', 'invoices:read'], ['clients:read'])).toBe(false);
    expect(hasAnyScope(['quotes:read'], [])).toBe(false);
  });

  it('canReadDocumentType is granted by EITHER the read or the write scope', () => {
    expect(canReadDocumentType(['quotes:read'], 'quote')).toBe(true);
    expect(canReadDocumentType(['quotes:write'], 'quote')).toBe(true);
    expect(canReadDocumentType(['invoices:read'], 'quote')).toBe(false);
  });

  it('canWriteDocumentType is granted ONLY by the write scope', () => {
    expect(canWriteDocumentType(['quotes:write'], 'quote')).toBe(true);
    expect(canWriteDocumentType(['quotes:read'], 'quote')).toBe(false);
  });

  it('a type with no declared scope at all can never be read or written through MCP', () => {
    expect(canReadDocumentType(['quotes:read', 'quotes:write'], 'some-plugin-type')).toBe(false);
    expect(canWriteDocumentType(['quotes:write'], 'some-plugin-type')).toBe(false);
  });
});
