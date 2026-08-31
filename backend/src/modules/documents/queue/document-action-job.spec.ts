import { buildDocumentActionJobData, buildDocumentActionJobId } from './document-action-job';

/**
 * Pure functions — no BullMQ, no Nest, no Redis. TODO.md item 22 explicitly asks for this: "forme du
 * job et déterminisme du jobId (fonctions pures testables sans broker)".
 */
describe('buildDocumentActionJobId', () => {
  it('is deterministic: the same (type, document, action) always produces the same id', () => {
    const first = buildDocumentActionJobId('quote', 'doc-1', 'send');
    const second = buildDocumentActionJobId('quote', 'doc-1', 'send');
    expect(first).toBe(second);
  });

  it('differs when ANY of type/document/action differs', () => {
    const base = buildDocumentActionJobId('quote', 'doc-1', 'send');
    expect(buildDocumentActionJobId('invoice', 'doc-1', 'send')).not.toBe(base);
    expect(buildDocumentActionJobId('quote', 'doc-2', 'send')).not.toBe(base);
    expect(buildDocumentActionJobId('quote', 'doc-1', 'save-draft')).not.toBe(base);
  });

  it('never contains a single ":" — BullMQ reserves that exact shape for its own repeatable job ids', () => {
    const id = buildDocumentActionJobId('quote', 'doc-1', 'send');
    // A DOUBLE colon (BullMQ's own repeatable format) is fine; a SINGLE one is what BullMQ's
    // Job.validateOptions rejects — see this file's own header and document-queue.dispatcher.ts's.
    const singleColon = /(?<!:):(?!:)/;
    expect(id).not.toMatch(singleColon);
  });

  it('is human-readable: "<actionId>-<typeId>-<documentId>"', () => {
    expect(buildDocumentActionJobId('invoice', 'doc-42', 'send')).toBe('send-invoice-doc-42');
  });
});

describe('buildDocumentActionJobData', () => {
  it('carries every field through verbatim, in the declared shape', () => {
    const data = buildDocumentActionJobData({
      companyId: 'company-1',
      typeId: 'quote',
      documentId: 'doc-1',
      actionId: 'send',
      payload: { data: { client: 'client-1' }, params: { recipient: 'a@b.com' } },
    });

    expect(data).toEqual({
      companyId: 'company-1',
      typeId: 'quote',
      documentId: 'doc-1',
      actionId: 'send',
      payload: { data: { client: 'client-1' }, params: { recipient: 'a@b.com' } },
    });
  });
});
