import { z } from 'zod';

import {
  canReadDocumentType,
  DOCUMENT_READ_SCOPES,
  DOCUMENT_WRITE_SCOPES,
  hasAnyScope,
  scopeForDocumentType,
} from './scope-mapping';
import { ToolDescriptor } from './types';

const inputSchema = {
  typeId: z.string().describe('A document type id from list_document_types, e.g. "quote" or "invoice"'),
  documentId: z.string(),
};

/**
 * One document instance in full: its stored field data, computed totals (net/VAT/gross —
 * `DocumentsService.computeTotals`, works for any type), and — for an invoice specifically — its
 * payment settlement (`getSettlement`: payments recorded, credits, resulting balance). Restricted to
 * "invoice" rather than every type because `getSettlement` is only meaningfully non-empty there
 * today: only the invoice registers a "record-payment" action, so calling it for any other type
 * would just be an extra round-trip that always comes back with empty payments/credits — an economy,
 * not a correctness rule (`getSettlement`'s own header says it degrades safely for any type).
 * `findOwnedDocument`'s tenant-scoped 404 (via `DocumentsService.getDocument`) applies unchanged.
 */
export const getDocumentTool: ToolDescriptor<typeof inputSchema> = {
  name: 'get_document',
  description:
    'Get one document instance in full — its stored data, computed totals, and (for an invoice) ' +
    'its payment settlement. 404s if it does not exist for the active company/type.',
  isRegistered: (scopes) => hasAnyScope([...DOCUMENT_READ_SCOPES, ...DOCUMENT_WRITE_SCOPES], scopes),
  inputSchema,
  handler: async (ctx, input) => {
    if (!canReadDocumentType(ctx.scopes, input.typeId)) {
      const required = scopeForDocumentType(input.typeId, 'read') ?? `${input.typeId}s:read`;
      throw new Error(
        `This API key's scopes do not cover document type "${input.typeId}" — grant "${required}" ` +
          '(or its write equivalent) to read it.',
      );
    }

    const document = await ctx.services.documentsService.getDocument(
      ctx.companyId,
      input.typeId,
      input.documentId,
    );
    const totals = await ctx.services.documentsService.computeTotals(
      ctx.companyId,
      input.typeId,
      input.documentId,
    );
    const settlement =
      input.typeId === 'invoice'
        ? await ctx.services.documentsService.getSettlement(ctx.companyId, input.typeId, input.documentId)
        : undefined;

    return {
      content: [
        {
          type: 'text',
          text: `Document "${input.documentId}" (${input.typeId}), status "${document.status}".`,
        },
      ],
      structuredContent: { document, totals, settlement: settlement ?? null },
    };
  },
};
