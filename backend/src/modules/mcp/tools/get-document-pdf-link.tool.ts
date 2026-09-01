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

const outputSchema = {
  typeId: z.string(),
  documentId: z.string(),
  downloadUrl: z.string(),
  expiresAt: z.string(),
};

/**
 * Mints a public, unauthenticated link to a document's PDF through the EXISTING share-links
 * mechanism (`ShareLinksService.create`, root TODO item 24) — this is exactly why that mechanism
 * exists: a chat client that does not render an MCP `resource` content block can still offer the
 * user a clickable URL. `ShareLinksService.create` already runs its own two gates (country policy
 * 403, status 409 — "a draft has no number and no legal existence yet to hand a stranger a link to")
 * unchanged; this tool adds nothing to them and does not catch their errors — see
 * run-document-action.tool.ts's own header on why a thrown `HttpException` already reaches the LLM
 * caller verbatim via the MCP SDK's own error handling.
 *
 * `ctx.baseUrl` (not an env var) is what turns the service's API-relative `path`
 * ("/api/public/documents/:token/pdf") into an absolute URL — see types.ts's own comment on why.
 */
export const getDocumentPdfLinkTool: ToolDescriptor<typeof inputSchema> = {
  name: 'get_document_pdf_link',
  description:
    "Create a public, unauthenticated link to a document's PDF, valid for 30 days, so a chat " +
    'client that does not render MCP resource blocks can still offer the user a clickable URL. ' +
    'Refuses a draft the same way the app\'s own "share link" button would — a draft has no number ' +
    'and no legal existence yet to hand a stranger a link to.',
  isRegistered: (scopes) => hasAnyScope([...DOCUMENT_READ_SCOPES, ...DOCUMENT_WRITE_SCOPES], scopes),
  inputSchema,
  outputSchema,
  handler: async (ctx, input) => {
    if (!canReadDocumentType(ctx.scopes, input.typeId)) {
      const required = scopeForDocumentType(input.typeId, 'read') ?? `${input.typeId}s:read`;
      throw new Error(
        `This API key's scopes do not cover document type "${input.typeId}" — grant "${required}" ` +
          '(or its write equivalent) to create a share link for it.',
      );
    }

    const link = await ctx.services.shareLinksService.create(ctx.companyId, input.typeId, input.documentId);
    const downloadUrl = `${ctx.baseUrl}${link.path}`;

    return {
      content: [
        {
          type: 'text',
          text:
            `Public PDF link created for ${input.typeId} "${input.documentId}" ` +
            `(expires ${link.expiresAt.toISOString()}): ${downloadUrl}`,
        },
      ],
      structuredContent: {
        typeId: input.typeId,
        documentId: input.documentId,
        downloadUrl,
        expiresAt: link.expiresAt.toISOString(),
      },
    };
  },
};
