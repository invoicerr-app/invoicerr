import { ArticlesService } from '@/modules/articles/articles.service';
import { ClientsService } from '@/modules/clients/clients.service';
import { InvoicesService } from '@/modules/invoices/invoices.service';
import { PdfLinksService } from '@/modules/pdf-links/pdf-links.service';
import { QuotesService } from '@/modules/quotes/quotes.service';
import { ApiKeyScope } from '@/modules/api-keys/scopes';
import { z } from 'zod';

export interface ToolContext {
  companyId: string;
  // null (session auth) is never actually reachable through the MCP
  // controller in practice — only API keys call this endpoint — but the
  // type mirrors RequestWithUser.scopes for consistency with hasScope().
  scopes: string[] | null;
  services: {
    quotesService: QuotesService;
    invoicesService: InvoicesService;
    clientsService: ClientsService;
    articlesService: ArticlesService;
    pdfLinksService: PdfLinksService;
  };
}

// One content block per MCP content-block kind a tool handler here actually
// emits — a (named, reusable) strict subset of the MCP SDK's CallToolResult
// content union, not the full union.
export type ToolContentBlock =
  | { type: 'text'; text: string }
  | { type: 'resource'; resource: { uri: string; mimeType: string; blob: string } };

export interface ToolResult {
  // Index signature matches the MCP SDK's own (loosely-typed) CallToolResult
  // shape, which registerTool()'s handler callback is expected to return.
  [key: string]: unknown;
  content: ToolContentBlock[];
  structuredContent?: Record<string, unknown>;
}

export interface ToolDescriptor<Input extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  description: string;
  scope: ApiKeyScope;
  inputSchema: Input;
  outputSchema?: z.ZodRawShape;
  handler: (ctx: ToolContext, input: z.objectOutputType<Input, z.ZodTypeAny>) => Promise<ToolResult>;
}
