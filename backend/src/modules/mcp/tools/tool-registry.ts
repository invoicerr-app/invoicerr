import { ToolDescriptor } from './types';
import { createClientTool } from './create-client.tool';
import { getDocumentTool } from './get-document.tool';
import { getDocumentPdfLinkTool } from './get-document-pdf-link.tool';
import { listArticlesTool } from './list-articles.tool';
import { listClientsTool } from './list-clients.tool';
import { listDocumentsTool } from './list-documents.tool';
import { listDocumentTypesTool } from './list-document-types.tool';
import { runDocumentActionTool } from './run-document-action.tool';

// Every new tool is one file + one entry here — mcp-server.factory.ts is the only place that
// touches the SDK's registration API (same discipline the repère's own registry held, git tag
// `avant-refonte-documents`). Five GENERIC, per-descriptor tools (the new model, item 23) plus the
// three ENTITY tools the repère already had (clients/articles are not document types).
export const TOOL_REGISTRY: ToolDescriptor<any>[] = [
  listDocumentTypesTool,
  listDocumentsTool,
  getDocumentTool,
  runDocumentActionTool,
  getDocumentPdfLinkTool,
  listClientsTool,
  createClientTool,
  listArticlesTool,
];
