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
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe('Max documents to return, most recently updated first (default 20, max 50)'),
};

/**
 * Saved instances of ONE type, for the active company — `DocumentsService.listDocuments` already
 * caps at 50 (persistence.ts's own `take` default); this tool applies a further, caller-chosen
 * `limit` (default 20) on top rather than growing that method a new parameter of its own — a plain
 * `.slice()` is all "paginé raisonnable" needs here, and it keeps DocumentsService's own signature,
 * used by the REST controller too, untouched.
 */
export const listDocumentsTool: ToolDescriptor<typeof inputSchema> = {
  name: 'list_documents',
  description:
    'List saved document instances of one type for the active company, most recently updated ' +
    'first — status, number, and stored field data for each. Call list_document_types first if you ' +
    'do not already know a valid typeId.',
  isRegistered: (scopes) => hasAnyScope([...DOCUMENT_READ_SCOPES, ...DOCUMENT_WRITE_SCOPES], scopes),
  inputSchema,
  handler: async (ctx, input) => {
    if (!canReadDocumentType(ctx.scopes, input.typeId)) {
      const required = scopeForDocumentType(input.typeId, 'read') ?? `${input.typeId}s:read`;
      throw new Error(
        `This API key's scopes do not cover document type "${input.typeId}" — grant "${required}" ` +
          '(or its write equivalent) to list its documents.',
      );
    }

    const take = input.limit ?? 20;
    const documents = await ctx.services.documentsService.listDocuments(ctx.companyId, input.typeId);
    const limited = documents.slice(0, take);
    const summary = limited.map((doc) => ({
      id: doc.id,
      status: doc.status,
      number: doc.number ?? null,
      displayNumber: doc.displayNumber ?? null,
      data: doc.data,
      updatedAt: doc.updatedAt,
    }));

    return {
      content: [{ type: 'text', text: `${summary.length} document(s) of type "${input.typeId}" found.` }],
      structuredContent: { documents: summary },
    };
  },
};
