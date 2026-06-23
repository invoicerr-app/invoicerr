---
sidebar_position: 10
---

# Settings

The **Settings** page is organised into tabs, each covering a different aspect of your instance.

## Company

Your business identity — this information appears on every document you issue.

- **Name** (required)
- **VAT Number** (optional)
- **Legal ID / SIRET** (optional)
- **Address** — Street, Address Line 2, Postal Code, City, State / Province, Country
- **Email** and **Phone**
- **Website**
- **Currency** — default currency for new documents
- **Date Format**
- **Logo** — upload your company logo (appears on PDFs)
- **Exempt VAT** — toggle to disable VAT on all documents

### Document numbering

- **Quote Number Format** and **Starting Number**
- **Invoice Number Format** and **Starting Number**
- **Receipt Number Format** and **Starting Number**

### Invoice PDF format

- Choose the default e-invoicing format: **PDF**, **Factur-X**, **ZUGFeRD**, **XRechnung**, **UBL**, or **CII**

## PDF Templates

Customise the appearance of your PDF documents. Upload a custom CSS file or adjust layout options.

## Email Templates

Customise the email body sent to clients when you send quotes for signature or invoices by email. Supports placeholders for dynamic content.

## Webhooks

Configure webhook endpoints to receive real-time events (e.g. `quote.signed`, `invoice.paid`). See the [Webhooks developer guide](../developer-guide/webhooks.md) for event types and payloads.

## API Keys

Generate and manage API keys for programmatic access. Each key can be named and revoked independently.

## Logs

View audit logs of activity in your instance — who did what and when.

## Account

Your personal account settings: name, email, password, and profile preferences.

## Invitations

Invite team members to your instance. Enter their email and assign a role. Pending and accepted invitations are listed here.

## Plugins

Manage installed plugins. Upload, enable, or disable plugins to extend Invoicerr's functionality. See the [Plugin System developer guide](../developer-guide/plugin-system.md) for development.

## Danger Zone

Destructive actions for instance administrators:

- **Delete all documents** — removes all quotes, invoices, and receipts (keeps clients and settings)
- **Delete instance** — permanently deletes the entire instance and all data
