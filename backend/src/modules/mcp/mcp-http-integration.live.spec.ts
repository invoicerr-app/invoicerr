import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { liveDescribe } from '../documents/transports/live-gate';

/**
 * The E2E-ish proof this module's own task calls for: a REAL POST HTTP round trip against the
 * running TEST backend (:4000 — `npm run start:test`), not a direct in-process call into a
 * handler. Uses the MCP SDK's own `StreamableHTTPClientTransport` (real `fetch()` calls under the
 * hood) rather than hand-rolled JSON-RPC bodies, so the actual wire protocol — `initialize` ->
 * `tools/list` -> `tools/call`, session id, SSE/JSON content negotiation — is what gets exercised,
 * the same client any real MCP host (Claude, an agent framework) would use.
 *
 * A Cypress spec has no screen to drive here (there is no MCP UI beyond the pre-existing "API Keys"
 * settings screen, unchanged by this module — see 13-api-keys.cy.ts) — this file is the intended
 * substitute, proving the wire itself rather than a page.
 *
 * Self-gated the same way every other `*.live.spec.ts` in this codebase is (`live-gate.ts`): silent
 * no-op unless `MCP_HTTP_LIVE=1`, so a normal `npm test` (and CI's backend-jest job, which never
 * boots a live server) never depends on `npm run start:test` actually being up. Run explicitly:
 *
 *   MCP_HTTP_LIVE=1 npx jest src/modules/mcp/mcp.http.spec.ts
 *
 * No credential env vars are required (`live-gate.ts`'s second parameter) — this hits our OWN test
 * backend, not a third-party API — but the flag keeps it from silently running (and depending on a
 * live server) in every ordinary `npm test` invocation.
 */
const describeLive = liveDescribe('MCP_HTTP_LIVE');

const BASE_URL = process.env.MCP_HTTP_BASE_URL || 'http://localhost:4000';
const TEST_EMAIL = 'john.doe@acme.org';
const TEST_PASSWORD = 'Super_Secret_Password123!';

describeLive('MCP endpoint — real HTTP round trip against the test backend', () => {
  jest.setTimeout(30000);

  let apiKey: string;

  beforeAll(async () => {
    // Sign-up is tolerant of "already exists" (the same account e2e's cy.login() reuses across
    // suites, e2e/cypress/support/commands.ts) — sign-in is the one call that MUST succeed.
    await fetch(`${BASE_URL}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'John Doe',
        firstname: 'John',
        lastname: 'Doe',
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
      }),
    }).catch(() => undefined);

    const signIn = await fetch(`${BASE_URL}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
    });
    if (signIn.status >= 300) {
      throw new Error(`sign-in failed (${signIn.status}) — is the test backend up at ${BASE_URL}?`);
    }
    const setCookie = signIn.headers.get('set-cookie');
    if (!setCookie) throw new Error('sign-in did not set a session cookie');
    const cookie = setCookie.split(';')[0];

    const getSession = () =>
      fetch(`${BASE_URL}/api/auth/get-session`, { headers: { cookie } }).then((r) => r.json());

    let session = await getSession();
    if (!session.companies || session.companies.length === 0) {
      // Same French, SIRET-bearing baseline company e2e's `cy.login()` seeds — this suite is not the
      // first thing to ever run against this backend in general, but must not ASSUME it isn't.
      const created = await fetch(`${BASE_URL}/api/companies`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({
          name: 'Acme Corp',
          description: 'A fictional company',
          phone: '+33123456789',
          email: 'contact@acme.org',
          address: '123 Main St',
          city: 'Paris',
          postalCode: '75001',
          country: 'France',
          countryCode: 'FR',
          currency: 'EUR',
          identifiers: [
            { scheme: 'LEGAL_ID', value: '73282932000074' },
            { scheme: 'VAT', value: 'FR44732829320' },
          ],
        }),
      });
      if (created.status >= 300) {
        throw new Error(`company creation failed (${created.status})`);
      }
      session = await getSession();
    }
    if (!session.activeCompanyId) {
      throw new Error('no active company after sign-in — cannot create a scoped API key');
    }

    // The API key IS the access mechanism this whole suite proves — minted through the ordinary,
    // session-authenticated REST endpoint (ApiKeysController), exactly the way the "API Keys"
    // settings screen does (13-api-keys.cy.ts).
    const createdKey = await fetch(`${BASE_URL}/api/api-keys`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        name: `mcp-http-integration-${Date.now()}`,
        scopes: ['quotes:read', 'quotes:write', 'clients:read', 'clients:write'],
      }),
    }).then((r) => r.json());
    if (!createdKey.key) {
      throw new Error(`API key creation did not return a plaintext key: ${JSON.stringify(createdKey)}`);
    }
    apiKey = createdKey.key;
  });

  it('drives initialize -> tools/list -> tools/call over the real streamable-HTTP transport', async () => {
    const transport = new StreamableHTTPClientTransport(new URL(`${BASE_URL}/api/mcp`), {
      requestInit: { headers: { 'x-api-key': apiKey } },
    });
    const client = new Client({ name: 'invoicerr-mcp-integration-test', version: '1.0.0' });

    try {
      // `client.connect()` performs the real `initialize` JSON-RPC handshake over a real POST.
      await client.connect(transport);

      const { tools } = await client.listTools();
      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toEqual(
        expect.arrayContaining([
          'list_document_types',
          'list_documents',
          'get_document',
          'run_document_action',
          'get_document_pdf_link',
          'list_clients',
          'create_client',
        ]),
      );
      // articles:read/write was NOT granted to this key — must not even be listed.
      expect(toolNames).not.toContain('list_articles');

      const typesResult = await client.callTool({ name: 'list_document_types', arguments: {} });
      expect(typesResult.isError).toBeFalsy();
      const typeIds = (typesResult.structuredContent as { types: { id: string }[] }).types.map((t) => t.id);
      expect(typeIds).toContain('quote');
      // invoices:* WAS granted, but this proves the filtering is genuinely per-type, not "any
      // document scope shows everything": credit-note/expense/received-invoice were never granted.
      expect(typeIds).not.toContain('credit-note');

      const clientResult = await client.callTool({
        name: 'create_client',
        arguments: {
          name: `MCP Integration Test Client ${Date.now()}`,
          address: '1 rue de Test',
          postalCode: '75002',
          city: 'Paris',
          country: 'France',
          currency: 'EUR',
        },
      });
      expect(clientResult.isError).toBeFalsy();
      const clientId = (clientResult.structuredContent as { id: string }).id;
      expect(clientId).toBeTruthy();

      const draftResult = await client.callTool({
        name: 'run_document_action',
        arguments: {
          typeId: 'quote',
          actionId: 'save-draft',
          data: {
            client: clientId,
            issueDate: '2026-01-01',
            currency: 'EUR',
            notes: 'Created by mcp.http.spec.ts',
            lines: [{ description: 'MCP integration widget', quantity: 1, unitPrice: 10 }],
          },
        },
      });
      expect(draftResult.isError).toBeFalsy();
      const document = (draftResult.structuredContent as { document: { id: string; status: string } })
        .document;
      expect(document.status).toBe('draft');
      expect(document.id).toBeTruthy();

      // Proves the NAMED gate error survives the real wire, not just the in-process handler: this
      // key was never granted `invoices:write`.
      const deniedResult = await client.callTool({
        name: 'run_document_action',
        arguments: { typeId: 'invoice', actionId: 'save-draft', data: {} },
      });
      expect(deniedResult.isError).toBe(true);
      expect((deniedResult.content as { type: string; text: string }[])[0].text).toMatch(/invoices:write/);
    } finally {
      await client.close();
    }
  });
});
