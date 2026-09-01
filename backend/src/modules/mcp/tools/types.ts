import { z } from 'zod';

import { ArticlesService } from '@/modules/articles/articles.service';
import { ClientsService } from '@/modules/clients/clients.service';
import { DocumentsService } from '@/modules/documents/documents.service';
import { ShareLinksService } from '@/modules/documents/share-links/share-links.service';

/**
 * What every tool handler is closed over — built fresh per HTTP request by mcp.controller.ts (see
 * mcp-server.factory.ts's own header on why: stateless, no cross-request state to worry about).
 */
export interface ToolContext {
  companyId: string;
  // null (session auth) is never actually reachable through the MCP controller in practice — only
  // API keys call this endpoint — but the type mirrors RequestWithUser.scopes for consistency with
  // hasScope()/hasAnyScope().
  scopes: string[] | null;
  /**
   * The origin (scheme + host) THIS request actually reached the backend at, e.g.
   * "http://localhost:4000" — computed by mcp.controller.ts from the live request, never from an
   * env var. Only get-document-pdf-link.tool.ts uses it (to turn a share-link's API-relative `path`
   * into an absolute, clickable URL) — see that file's own header for why an env var (the repère's
   * own BETTER_AUTH_URL, git tag `avant-refonte-documents`) is the wrong tool for this job here.
   */
  baseUrl: string;
  services: {
    documentsService: DocumentsService;
    shareLinksService: ShareLinksService;
    clientsService: ClientsService;
    articlesService: ArticlesService;
  };
}

// One content block per MCP content-block kind a tool handler here actually emits — a (named,
// reusable) strict subset of the MCP SDK's CallToolResult content union, not the full union.
export type ToolContentBlock =
  | { type: 'text'; text: string }
  | { type: 'resource'; resource: { uri: string; mimeType: string; blob: string } };

export interface ToolResult {
  // Index signature matches the MCP SDK's own (loosely-typed) CallToolResult shape, which
  // registerTool()'s handler callback is expected to return.
  [key: string]: unknown;
  content: ToolContentBlock[];
  structuredContent?: Record<string, unknown>;
}

export interface ToolDescriptor<Input extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  description: string;
  /**
   * Whether this tool is registered at all for the caller's scopes — tools/list VISIBILITY (see
   * mcp-server.factory.ts's own header: a tool the caller's scopes don't cover never appears in
   * tools/list at all, rather than appearing and erroring on tools/call).
   *
   * A single fixed scope check for `list_clients`/`create_client`/`list_articles` — real business
   * ENTITIES a tool reads/writes directly, exactly the one-scope-per-tool shape the repère's own
   * tools always had (git tag `avant-refonte-documents`). The GENERIC, per-descriptor tools
   * (`list_document_types`, `list_documents`, `get_document`, `run_document_action`,
   * `get_document_pdf_link`) gate on a COARSER predicate instead — "does this key hold ANY
   * document-domain scope at all" — because the actual document TYPE these are asked to touch only
   * arrives as a CALL argument (`typeId`), never something registration time can know. See
   * scope-mapping.ts's own header for the precise, per-`typeId` check each of those tools' own
   * handler runs before doing anything else.
   */
  isRegistered: (scopes: string[] | null) => boolean;
  inputSchema: Input;
  outputSchema?: z.ZodRawShape;
  handler: (ctx: ToolContext, input: z.objectOutputType<Input, z.ZodTypeAny>) => Promise<ToolResult>;
}
