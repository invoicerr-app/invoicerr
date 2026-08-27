---
sidebar_position: 5
---

# MCP server

Invoicerr exposes a [Model Context Protocol](https://modelcontextprotocol.io) server so AI agents (e.g. OpenWebUI) can create quotes, invoices, clients, and articles directly from a chat, reusing the same service layer as the REST API. For how to connect a client and what you can ask it to do, see the [AI Agents user guide](../user-guide/ai-agents.md).

- **Endpoint**: `POST /api/mcp`
- **Transport**: Streamable HTTP, stateless (a fresh in-memory MCP server is built per request — there's no session state to manage or expire)
- **Auth**: `Authorization: Bearer <api-key>` — the same API keys used elsewhere, see [Authentication](./authentication.md#api-key-authentication)

## API key scopes

Every API key has a `scopes: string[]` column (`backend/src/modules/api-keys/scopes.ts`). Create or edit a key from **Settings → API Keys** and tick the scopes it needs:

| Scope | Grants |
|---|---|
| `quotes:write` | `create_quote` |
| `invoices:write` | `create_invoice`, `create_invoice_from_quote` |
| `clients:write` | `create_client` |
| `articles:write` | `create_article` |
| `articles:read` | `list_articles` |
| `quotes:read` | `get_quote_pdf` |
| `invoices:read` | `get_invoice_pdf` |
| `clients:read` | `list_clients` |

A key with no scopes ticked can still authenticate, but `tools/list` returns an empty toolset — harmless, but useless. Keys created before scopes existed were backfilled with all five scopes so existing integrations kept working; grant scopes deliberately for new keys instead of relying on that default.

Tools the key's scopes don't cover don't just error on call — they're absent from `tools/list` entirely, so an agent planning a task only ever sees what it can actually do.

## Available tools

| Tool | Scope | Maps to |
|---|---|---|
| `create_quote` | `quotes:write` | `QuotesService.createQuote` |
| `create_invoice` | `invoices:write` | `InvoicesService.createInvoice` |
| `create_invoice_from_quote` | `invoices:write` | `InvoicesService.createInvoiceFromQuote` |
| `create_client` | `clients:write` | `ClientsService.createClient` |
| `create_article` | `articles:write` | `ArticlesService.create` |
| `list_articles` | `articles:read` | `ArticlesService.findAll` |
| `get_quote_pdf` | `quotes:read` | `QuotesService.getQuotePdf` |
| `get_invoice_pdf` | `invoices:read` | `InvoicesService.getInvoicePdf` |
| `list_clients` | `clients:read` | `ClientsService.searchClients` |

Each tool is a thin adapter (`backend/src/modules/mcp/tools/*.ts`) — it validates input against a zod schema mirroring the equivalent REST DTO, calls the existing service with the API key's `companyId`, and returns both a short text summary and structured content (e.g. `{ id, name }`) so an agent can chain calls (create a client, then a quote for that client) without having to parse prose.

`list_clients` exists specifically so agents can look up an existing client (by name, contact, or address fragment) before calling `create_client` or before resolving a `clientId` for `create_quote`/`create_invoice` — both tool descriptions steer the agent toward calling it first and asking the user to disambiguate on ambiguous matches, though this is a prompting convention, not an enforced call order.

There's no separate "created via MCP" audit trail — creations show up the same way any other API-key-driven change does (`ApiKey.lastUsedAt`, and whatever webhooks the underlying service already dispatches on creation).

### PDF tools return both an embedded blob and a download link

`get_quote_pdf` and `get_invoice_pdf` return the PDF two ways in the same result:

- An embedded base64-encoded MCP "resource" content block (`{ type: 'resource', resource: { uri, mimeType: 'application/pdf', blob } }`). Client-side rendering support for this content type is still maturing across the ecosystem — OpenWebUI, for example, doesn't yet reliably render a PDF preview from it, it just shows an inert placeholder. The blob is still returned in full regardless, so an agent (or a script driving the MCP client) can always decode and use it even where the client shows no preview.
- A `downloadUrl` in `structuredContent` (and echoed in the text block) — a **public, unauthenticated, token-gated link** (`GET /api/pdf-links/:token`, `@AllowAnonymous()` in `backend/src/modules/pdf-links/pdf-links.controller.ts`) valid for **1 hour**, reusable until expiry, not single-use. This is what actually makes the PDF clickable/usable from a chat UI today: anyone with the link can view that one document until it expires, no API key needed — the 256-bit token (`PdfLinksService.createToken`, hashed at rest with SHA-256, same reasoning as `backend/src/utils/api-key.ts`) is the only access control. Both tool descriptions instruct the agent to surface `downloadUrl` to the user rather than relying on the embedded blob being visible.

Very large invoices/quotes produce correspondingly large base64 payloads for the embedded blob (~33% bigger than the raw PDF) — the `downloadUrl` doesn't have this overhead since it streams the PDF directly. If Invoicerr sits behind a reverse proxy, check its response-size limits if embedded-blob fetches for unusually large documents start failing.

## Client compatibility

Any MCP client that supports the Streamable HTTP transport with a static Bearer token can connect (OpenWebUI is the one Invoicerr documents and tests against — see the [AI Agents user guide](../user-guide/ai-agents.md)). Clients whose only remote-MCP auth option is OAuth (no static-token field) can't be pointed at this endpoint, since Invoicerr's MCP server intentionally only supports API-key auth, not a full OAuth 2.1 authorization server.
