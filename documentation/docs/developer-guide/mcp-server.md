---
sidebar_position: 5
---

# MCP server

Invoicerr exposes a [Model Context Protocol](https://modelcontextprotocol.io) server so AI agents (e.g. OpenWebUI) can browse and act on a company's documents (quotes, invoices, credit notes, expenses, received invoices), clients, and catalog articles directly from a chat, reusing the same service layer as the REST API. For how to connect a client and what you can ask it to do, see the [AI Agents user guide](../user-guide/ai-agents.md).

- **Endpoint**: `POST /api/mcp`
- **Transport**: Streamable HTTP, stateless (a fresh in-memory MCP server is built per request — there's no session state to manage or expire)
- **Auth**: `Authorization: Bearer <api-key>` — the same API keys used elsewhere, see [Authentication](./authentication.md#api-key-authentication)

## Tools are generic over document types, not one per kind

There is no `create_quote` or `create_invoice` tool. The document engine treats an invoice, a quote, a credit note, an expense, and a received invoice as five instances of the same generic `DocumentTypeDescriptor` shape, and the MCP layer mirrors that: five small tools, each an OPERATION rather than a document kind, that take a `typeId` argument (`"quote"`, `"invoice"`, …) instead of being duplicated per type.

The intended flow for an agent:

1. **`list_document_types`** — the entry point. Returns every document type the active company's country currently makes available, each with its full field list and its declared actions (and, for an action the company's country currently forbids, why — `policyBlockedReason`). This is the same descriptor a document's edit screen in the app itself renders from, so the agent discovers what it can do from data rather than from a hardcoded tool list.
2. **`list_documents`** — saved instances of one type, most recently updated first (status, number, stored field data).
3. **`get_document`** — one instance in full: stored data, computed totals, and, for an invoice specifically, its payment settlement.
4. **`run_document_action`** — the one generic mutation tool. Runs a declared action (`"save-draft"`, `"send"`, `"convert-to-invoice"`, …) of one type, exactly the same entry point the app's own UI goes through, so every gate the UI would hit applies here too: an unknown type or action, a country that forbids the action, a document status that doesn't allow it, an action declared but not yet implemented, or invalid field/param data all come back as a clear, named error rather than a silent no-op.
5. **`get_document_pdf_link`** — see below.

Three more tools exist for real business entities rather than document types — `list_clients`, `create_client`, `list_articles` — kept as simple, single-purpose tools because a client or a catalog article isn't resolved through the document-type registry the way a quote or invoice is.

Not every document type the backend knows about is reachable through this API: the document engine currently registers seven types, but only five (`quote`, `invoice`, `credit-note`, `expense`, `received-invoice`) have a matching pair of API-key scopes. A type with no declared scope fails closed — no key, however broadly scoped, can be granted MCP access to it.

There's no separate "created via MCP" audit trail — changes made this way show up the same way any other API-key-driven change does: `ApiKey.lastUsedAt` is bumped, and whatever webhooks the underlying service already dispatches on that action still fire.

## How scopes gate the tools

Every API key has a `scopes: string[]` column (`backend/src/modules/api-keys/scopes.ts`). Create or edit a key from **Settings → Integrations → API Keys** and tick the scopes it needs:

| Scope | Grants |
|---|---|
| `quotes:read` / `quotes:write` | read / act on quotes |
| `invoices:read` / `invoices:write` | read / act on invoices |
| `credit-notes:read` / `credit-notes:write` | read / act on credit notes |
| `expenses:read` / `expenses:write` | read / act on expenses |
| `received-invoices:read` / `received-invoices:write` | read / act on received invoices |
| `clients:read` | `list_clients` |
| `clients:write` | `create_client` |
| `articles:read` | `list_articles` |

A key with no scopes ticked can still authenticate, but `tools/list` returns an empty toolset — harmless, but useless. Note that `articles:write` is a real, grantable scope (the REST API uses it) with no matching MCP tool today — there is no `create_article` tool in the registry, so granting it has no effect on what an agent can do through this endpoint.

The check is split in two, because the five generic tools above don't map to a single fixed scope the way `list_clients`/`create_client`/`list_articles` do — which document type a call touches only arrives as a call argument (`typeId`), never something registration time can know:

1. **Registration time** (`tools/list` visibility) — coarse. The four read-oriented generic tools (`list_document_types`, `list_documents`, `get_document`, `get_document_pdf_link`) appear for a key holding *any* document-domain scope at all, read or write, for any type. `run_document_action` — the one generic tool that mutates anything — only appears for a key holding at least one *write* scope for some type, since a read-only key could never call it successfully anyway. A key holding only `clients:read` sees none of the five generic tools. A key holding only `quotes:write` sees all five, even though calling `run_document_action` with `typeId: "invoice"` is still refused at the next step. Tools a key's scopes don't cover at all don't just error on call — they're absent from `tools/list` entirely, so an agent planning a task only ever sees what it can actually do.
2. **Call time**, inside each tool's own handler — precise: does the key hold the scope for *this specific* `typeId`? The scope name is computed by pluralizing the type id (`"quote"` → `"quotes:read"`, `"credit-note"` → `"credit-notes:write"`, …). `list_documents`, `get_document`, and `get_document_pdf_link` accept either the read or the write scope for that type (a key allowed to write a type can certainly read it back); `run_document_action` always requires the write scope, since every registered action mutates or creates. This MCP-specific scope check runs *before* the document engine's own four gates on `run_document_action` (country policy, status, implementation, validation — plus a plain 404 if the type or action itself is unknown) — it is never a substitute for them, and a scope-denied call never reaches those gates at all.

## The public PDF link, plainly

`get_document_pdf_link` mints a **public, unauthenticated link** to a document's PDF, through the same share-link mechanism the app's own UI exposes on a document's own detail screen ("share link" dialog). Concretely:

- The link needs no login and no API key. **Anyone who holds the URL can open that document's PDF** for as long as the link is valid — the 256-bit token is the only access control, and it is never logged or stored in the clear (only its SHA-256 hash is persisted).
- It is valid for **30 days** from creation, not an hour — deliberately: this is a persistent, listable, revocable link a company can hand to a client to actually open an invoice, not a single-conversation throwaway.
- It is **revocable**: the app exposes list/revoke endpoints (`GET .../share-links`, `DELETE .../share-link/:tokenId`) and a screen built on them. Revoking it — or letting it expire — makes it dead immediately. An unknown token, an expired one, and a revoked one all resolve to the exact same 404, with the exact same body: the public endpoint never lets a caller distinguish "this link once existed" from "this link was never real".
- `ShareLinksService.create` applies two gates before minting a link, unchanged from what the equivalent app-driven action already enforces: a country-policy check (some countries' rules can forbid the "share-link" action outright, 403) and a status check (a draft is refused — "a draft has no number and no legal existence yet to hand a stranger a link to", 409). There is no format/implementation gate here (a link has no "syntax" to resolve) and no data-validation gate (there's nothing to build).
- The tool's own description instructs the agent to surface `downloadUrl` into the conversation so a chat client that can't render an embedded file can still offer the user something clickable. That instruction is also the exposure: once the link is in the conversation, it lands in whatever log that conversation (or the assistant's provider) keeps, for as long as the link itself stays valid. Treat minting this link the same way you'd treat pasting a document's contents into that chat.

## Your assistant's model provider is not a sub-processor of this project

Invoicerr neither calls nor chooses the AI model behind the assistant you connect to this endpoint — you select and configure that provider yourself, and it has no contract with Invoicerr. Full position, including what that means for any Customer Personal Data your assistant sends to that provider: the [Data Processing Agreement](../legal/data-processing-agreement.md), Section 7.

## Client compatibility

Any MCP client that supports the Streamable HTTP transport with a static Bearer token can connect (OpenWebUI is the one Invoicerr documents and tests against — see the [AI Agents user guide](../user-guide/ai-agents.md)). Clients whose only remote-MCP auth option is OAuth (no static-token field) can't be pointed at this endpoint, since Invoicerr's MCP server intentionally only supports API-key auth, not a full OAuth 2.1 authorization server.
