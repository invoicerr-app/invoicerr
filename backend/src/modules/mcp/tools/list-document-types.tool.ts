import {
  canReadDocumentType,
  DOCUMENT_READ_SCOPES,
  DOCUMENT_WRITE_SCOPES,
  hasAnyScope,
} from './scope-mapping';
import { ToolDescriptor } from './types';

const inputSchema = {};

/**
 * The types the active company's COUNTRY makes available at all — the exact same decision the
 * frontend's Documents sidebar renders from (`DocumentsService.listAvailableTypes`) — each with its
 * FULL descriptor: fields and DECLARED actions, every action carrying its own `policyBlockedReason`
 * when this company's country currently forbids it (`describeTypeForCompany`, the identical view a
 * frontend form renders from). This is the whole point of the descriptor model applied to an LLM
 * caller: it reads the SHAPE of a document type from data, the same way the frontend does, instead
 * of a human hand-maintaining a fixed tool per type the way the repère's `create_quote`/
 * `create_invoice` did (git tag `avant-refonte-documents`).
 *
 * Filtered to the types THIS API KEY actually holds a scope for (read OR write, see
 * `canReadDocumentType`) — a key scoped to `quotes:read` only never sees the invoice descriptor
 * here, regardless of what the company's country would otherwise allow. No `outputSchema`: a
 * document type's field tree is arbitrarily nested (an 'array' field's own `fields`), which the MCP
 * SDK's strict output validation is not worth fighting for a shape this open-ended — `content` +
 * `structuredContent` are still both returned, only the schema-checked guarantee is skipped.
 */
export const listDocumentTypesTool: ToolDescriptor<typeof inputSchema> = {
  name: 'list_document_types',
  description:
    'List the document types available to the active company (e.g. "quote", "invoice"), each with ' +
    'its full field and action descriptor. Call this BEFORE run_document_action: it names every ' +
    "action this company's country currently allows for a type (and, for one it blocks, WHY, via " +
    'policyBlockedReason) and every field a document of that type accepts. Only types this API key ' +
    'holds a scope for are returned.',
  isRegistered: (scopes) => hasAnyScope([...DOCUMENT_READ_SCOPES, ...DOCUMENT_WRITE_SCOPES], scopes),
  inputSchema,
  handler: async (ctx) => {
    const { types, reason } = await ctx.services.documentsService.listAvailableTypes(ctx.companyId);
    const visible = types.filter((type) => canReadDocumentType(ctx.scopes, type.id));
    const descriptors = await Promise.all(
      visible.map((type) => ctx.services.documentsService.describeTypeForCompany(ctx.companyId, type.id)),
    );
    const summary = descriptors.map((descriptor) => ({
      id: descriptor.id,
      label: descriptor.label,
      fields: descriptor.fields,
      actions: descriptor.actions,
    }));

    return {
      content: [{ type: 'text', text: `${summary.length} document type(s) available.` }],
      structuredContent: { types: summary, reason: reason ?? null },
    };
  },
};
