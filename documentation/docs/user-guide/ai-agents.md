---
sidebar_position: 8
---

# AI Agents

Connect Invoicerr to an AI chat assistant (like [OpenWebUI](https://openwebui.com)) so you can create quotes, invoices, clients, and articles — or fetch a PDF copy of one — just by asking, without leaving the conversation.

## What you can ask it to do

- *"Create a client named Acme Corp, 12 Rue de la Paix, Paris."*
- *"Make a quote for Acme Corp with one line: Website redesign, 2 500€, 20% VAT."*
- *"Turn quote #Q-2026-0042 into an invoice."*
- *"Add an article to the catalog: Monthly hosting, 49€, VAT 20%."*
- *"Get me the PDF for invoice #INV-2026-0018."*

The assistant only sees the actions its API key is allowed to perform (see **Permissions** below) — if it can't do something, it simply won't offer to.

If you ask it to create a quote or invoice for a client that already exists, it looks them up first instead of creating a duplicate — and if it finds more than one client that could match, it will ask you which one you mean before doing anything.

## Setting it up

### 1. Create an API key with the right permissions

Go to **Settings → Account & Team → API Keys**, create a new key, and tick the permissions you want the assistant to have:

- **Create quotes** / **Create invoices** / **Create clients** / **Create articles** — lets it add new records for you
- **Read articles** — lets it look up your existing catalog
- **Read clients** — lets it look up your existing clients before creating a new one (avoids duplicates)
- **Read quotes** / **Read invoices** — lets it fetch a PDF copy of a quote or invoice

Grant only what you actually want an assistant acting on: you can always come back and adjust a key's permissions later. Copy the key somewhere safe — it's only shown once.

### 2. Connect it to OpenWebUI

1. In OpenWebUI, go to **Admin Settings → Integrations → External Tool Servers → +**
2. Set **Type** to **MCP (Streamable HTTP)** (it defaults to "OpenAPI" — change it)
3. **URL**: `https://<your-invoicerr-domain>/api/mcp`
4. **Auth**: **Bearer**, then paste your API key
5. Give it a name and save

Once connected, enable the tool server for a chat (the "+" next to the message box, or set it as a default for a model in **Workspace → Models**) and start asking.

## Good to know

- Fetching a PDF also gives you a direct link, valid for **1 hour**, that you can open yourself even if the chat app doesn't show an inline preview — no login needed to open it, just don't share it with anyone you don't want seeing that document.
- Anything the assistant creates shows up in Invoicerr exactly like anything created through the app itself — same numbering, same webhooks, same audit trail (`API key last used` in Settings).
