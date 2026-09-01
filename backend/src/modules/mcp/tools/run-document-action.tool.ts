import { z } from 'zod';

import {
  canWriteDocumentType,
  DOCUMENT_WRITE_SCOPES,
  hasAnyScope,
  scopeForDocumentType,
} from './scope-mapping';
import { ToolDescriptor } from './types';

const inputSchema = {
  typeId: z.string().describe('A document type id from list_document_types, e.g. "quote" or "invoice"'),
  actionId: z
    .string()
    .describe('A DECLARED action id from that type\'s descriptor, e.g. "save-draft" or "send"'),
  documentId: z.string().optional().describe('Omit to create a new document instance of this type'),
  data: z
    .record(z.unknown())
    .optional()
    .describe("The document's own field values (see the type's descriptor)"),
  params: z.record(z.unknown()).optional().describe("The action's own parameters, if it declares any"),
};

/**
 * THE generic mutation tool — runs one DECLARED action of one document type through
 * `DocumentsService.runAction`, the single entry point the app's own UI (and REST API) goes through
 * for every write. Nothing here re-implements or bypasses ANY of `runAction`'s four gates:
 *
 *  1. unknown type/action -> a plain 404-shaped error, named.
 *  2. the active company's country forbids this action -> its own named reason (403).
 *  3. wrong status for the record -> a named 409, citing the actual and required status/policy.
 *  4. declared but unimplemented -> a named 501.
 *  5. invalid document data or action params -> a named 400, per field.
 *
 * Every one of these is a plain thrown `HttpException`; this handler does NOT catch them — the MCP
 * SDK's own `CallToolRequestSchema` dispatcher already converts any thrown error into
 * `{ content: [...], isError: true }` using `error.message` (verified against
 * `@nestjs/common`'s `HttpException`: even `new BadRequestException({ message, errors })` exposes
 * the intended human message via `.message`, not `"[object Object]"`) — so the NAMED message from
 * whichever gate fired reaches the LLM caller VERBATIM, the exact behavior this tool exists to
 * preserve. The ONE gate ADDED here, ahead of all five above, is this API key's own MCP scope for
 * `typeId` (see scope-mapping.ts) — a request an unscoped key can make that never even reaches
 * `DocumentsService` at all.
 */
export const runDocumentActionTool: ToolDescriptor<typeof inputSchema> = {
  name: 'run_document_action',
  description:
    'Run one DECLARED action of one document type (e.g. "save-draft", "send", "approve", "reject") ' +
    "— the same single entry point the app's own UI goes through, so every gate the UI would hit " +
    'applies here too: a country that forbids this action, a document status that does not allow ' +
    'it, an action declared but not implemented, or invalid field/param data all come back as a ' +
    'clear, named error — never a silent no-op. Call list_document_types first to see which actions ' +
    'and fields a type declares, and which are currently blocked for this company and why.',
  isRegistered: (scopes) => hasAnyScope(DOCUMENT_WRITE_SCOPES, scopes),
  inputSchema,
  handler: async (ctx, input) => {
    if (!canWriteDocumentType(ctx.scopes, input.typeId)) {
      const required = scopeForDocumentType(input.typeId, 'write') ?? `${input.typeId}s:write`;
      throw new Error(
        `This API key's scopes do not include "${required}" — required to run actions on document ` +
          `type "${input.typeId}".`,
      );
    }

    const result = await ctx.services.documentsService.runAction(
      ctx.companyId,
      input.typeId,
      input.actionId,
      {
        documentId: input.documentId,
        data: (input.data as Record<string, unknown>) ?? {},
        params: (input.params as Record<string, unknown>) ?? {},
      },
    );

    const summary =
      result.message ??
      `Action "${input.actionId}" ran on document type "${input.typeId}"` +
        (result.document ? ` (id: ${result.document.id}, status: ${result.document.status}).` : '.');

    return {
      content: [{ type: 'text', text: summary }],
      structuredContent: {
        document: result.document ?? null,
        changed: result.changed,
        message: result.message ?? null,
      },
    };
  },
};
