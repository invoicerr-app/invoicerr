import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { TOOL_REGISTRY } from './tools/tool-registry';
import { ToolContext } from './tools/types';
import { hasScope } from '@/utils/scope-check';

// Stateless mode: a fresh McpServer + transport per HTTP request, so
// companyId/scopes can be safely closed over per-call with no cross-request
// state to worry about (each request is independently authenticated via
// API key).
export function createMcpServerForRequest(ctx: ToolContext) {
  // Declaring the tools capability up front (rather than relying on it
  // being implicitly set by the first registerTool() call) means a key
  // with zero granted scopes — which registers no tools at all — can still
  // legally wire up the tools/list and tools/call handlers below; without
  // this, server.setRequestHandler() rejects them with "Server does not
  // support tools".
  const server = new McpServer({ name: 'invoicerr', version: '1.0.0' }, { capabilities: { tools: {} } });
  let registeredAny = false;

  // Tools the caller's scopes don't cover simply aren't registered — they
  // don't show up in tools/list at all, rather than appearing and
  // erroring on tools/call. More agent-friendly (fails fast at planning
  // time) and doesn't leak the existence of capabilities the caller has
  // no rights to.
  for (const tool of TOOL_REGISTRY) {
    if (hasScope({ scopes: ctx.scopes }, tool.scope)) {
      server.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema: tool.inputSchema,
          outputSchema: tool.outputSchema,
        },
        async (input: any) => tool.handler(ctx, input),
      );
      registeredAny = true;
    }
  }

  // McpServer only wires up its tools/list and tools/call JSON-RPC handlers
  // the first time a tool is registered — an API key with zero granted
  // scopes would otherwise make tools/list itself fail with a "method not
  // found" error instead of cleanly returning an empty list. Register the
  // handlers directly in that case so the connection still behaves like a
  // server that simply has no tools, not a broken one.
  if (!registeredAny) {
    server.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }));
    server.server.setRequestHandler(CallToolRequestSchema, async () => ({
      content: [{ type: 'text', text: 'This API key has no granted scopes — no tools are available.' }],
      isError: true,
    }));
  }

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  return { server, transport };
}
