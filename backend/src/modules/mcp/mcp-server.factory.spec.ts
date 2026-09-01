import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createMcpServerForRequest } from './mcp-server.factory';
import { ToolContext } from './tools/types';

/**
 * Proves the factory's own contract (its header comment, reprised unchanged from the repère — git
 * tag `avant-refonte-documents`): tools out of scope are never REGISTERED (absent from tools/list,
 * not merely refused on tools/call), and a key with zero granted scopes still gets a WORKING server
 * (empty tools/list, a clean isError on tools/call) rather than a broken JSON-RPC connection.
 *
 * Drives a REAL protocol round trip — `InMemoryTransport.createLinkedPair()` (the SDK's own testing
 * transport) connects the factory's `McpServer` to a real `Client`, so `listTools()`/`callTool()`
 * below exercise the actual `initialize` -> `tools/list` -> `tools/call` JSON-RPC dispatch, not a
 * direct call into a tool's handler (that proof — the four gates behind `run_document_action` — is
 * run-document-action.tool.spec.ts's job instead).
 */
function fakeServices(): ToolContext['services'] {
  return {
    documentsService: {} as never,
    shareLinksService: {} as never,
    clientsService: { searchClients: jest.fn().mockResolvedValue([]) } as never,
    articlesService: { findAll: jest.fn().mockResolvedValue([]) } as never,
  };
}

async function connect(scopes: string[] | null) {
  const ctx: ToolContext = {
    companyId: 'company-1',
    scopes,
    baseUrl: 'http://localhost:4000',
    services: fakeServices(),
  };
  const { server } = createMcpServerForRequest(ctx);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: 'invoicerr-mcp-factory-test', version: '1.0.0' });
  await client.connect(clientTransport);

  return { client, server };
}

describe('createMcpServerForRequest', () => {
  it('registers zero tools for a key with zero granted scopes, yet still answers tools/list cleanly', async () => {
    const { client } = await connect([]);

    const { tools } = await client.listTools();
    expect(tools).toEqual([]);
  });

  it('an empty-scope connection answers tools/call with a clean isError, never a broken JSON-RPC connection', async () => {
    const { client } = await connect([]);

    const result = await client.callTool({ name: 'list_document_types', arguments: {} });
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      { type: 'text', text: 'This API key has no granted scopes — no tools are available.' },
    ]);
  });

  it('a key scoped only to an ENTITY (clients:read) sees exactly that one tool — not the generic document tools', async () => {
    const { client } = await connect(['clients:read']);

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['list_clients']);
  });

  it('a key scoped to a single document domain (quotes:write) sees every GENERIC document tool, but no entity tool', async () => {
    const { client } = await connect(['quotes:write']);

    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'get_document',
        'get_document_pdf_link',
        'list_document_types',
        'list_documents',
        'run_document_action',
      ].sort(),
    );
  });

  it('every tool is registered for a fully-scoped key', async () => {
    const { client } = await connect([
      'quotes:read',
      'quotes:write',
      'clients:read',
      'clients:write',
      'articles:read',
    ]);

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        'list_document_types',
        'list_documents',
        'get_document',
        'run_document_action',
        'get_document_pdf_link',
        'list_clients',
        'create_client',
        'list_articles',
      ].sort(),
    );
  });

  it('a document-generic tool IS registered on a partial scope, but its own call-time gate refuses a typeId that scope does not cover', async () => {
    const { client } = await connect(['quotes:write']); // no invoices:write

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain('run_document_action');

    const result = await client.callTool({
      name: 'run_document_action',
      arguments: { typeId: 'invoice', actionId: 'save-draft', data: {} },
    });
    expect(result.isError).toBe(true);
    expect((result.content as { type: string; text: string }[])[0].text).toMatch(/invoices:write/);
  });
});
