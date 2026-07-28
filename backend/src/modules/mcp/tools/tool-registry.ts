import { ToolDescriptor } from './types';
import { createArticleTool } from './create-article.tool';
import { createClientTool } from './create-client.tool';
import { createInvoiceFromQuoteTool } from './create-invoice-from-quote.tool';
import { createInvoiceTool } from './create-invoice.tool';
import { createQuoteTool } from './create-quote.tool';
import { getInvoicePdfTool } from './get-invoice-pdf.tool';
import { getQuotePdfTool } from './get-quote-pdf.tool';
import { listArticlesTool } from './list-articles.tool';
import { listClientsTool } from './list-clients.tool';

// Every new tool is one file + one entry here — mcp-server.factory.ts is the
// only place that touches the SDK's registration API.
export const TOOL_REGISTRY: ToolDescriptor<any>[] = [
  createQuoteTool,
  createInvoiceTool,
  createInvoiceFromQuoteTool,
  createClientTool,
  createArticleTool,
  listArticlesTool,
  listClientsTool,
  getQuotePdfTool,
  getInvoicePdfTool,
];
