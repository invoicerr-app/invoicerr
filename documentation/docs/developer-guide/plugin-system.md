---
sidebar_position: 2
---

# Extension Points

Invoicerr had an in-app, DB-backed, Settings-configurable plugin mechanism (`PluginRegistry`/
`PluginType`, the `Plugin` table, a Settings > Plugins screen) with two categories that were ever
actually registered: `STORAGE` (a company/instance choosing between an S3 bucket and local disk for
a signed quote or paid invoice PDF) and `SIGNING` (dead since quote e-signature was removed). It was
**removed** (2026-09-17): a per-deployment S3 storage toggle a tenant admin could point at their own
bucket is not a product this app offers any more — periodic backup of every document is now handled
at the INSTANCE level instead (`backend/src/modules/backup/`), never a Settings screen. See
[History](#history) below for the earlier, also-removed git-clone plugin mechanism this one itself
replaced.

Document storage today is unconditional: received-invoice attachments, company branding assets, and
the legal archive each write to their own fixed backend (local disk by default; the legal archive
alone also supports `ARCHIVE_STORAGE=s3`, an unrelated, env-configured mechanism — see
`backend/src/modules/documents/archive/s3-storage.ts`'s own header for why it shares nothing with
the removed plugin).

## The narrow-interface-at-the-core pattern

What replaces `PluginRegistry` as this codebase's way to add a genuinely new capability — one that
isn't a country's rules or a document type's shape (see [Extending Invoicerr](./extending-invoicerr.md)
for those two axes) — is a **narrow interface at the core, with a registry the feature itself owns**,
never a generic, instance-wide, single-active-provider table.

The reference example is received-document OCR extraction (`ReceivedDocumentExtractor`,
`backend/src/modules/documents/received-invoices/ocr/extractor.ts`) and its implementation
(`backend/src/plugins/ocr/providers/local/local.ts`). Its whole configuration is one environment
variable, `OCR_SERVICE_URL`, naming a container — never a database row, never a Settings screen. A
test double (`FakeReceivedInvoiceOcrExtractor`) is registered instead under `NODE_ENV=test`, the same
swap discipline `clients.module.ts`'s `VAT_VALIDATION_FAKE` already establishes elsewhere in this
codebase. `backend/src/plugins/index.ts` is the composition root: the only file allowed to import
both the core's extension point and a real (or fake) implementation of it — `received-invoices/`
itself never imports the OCR provider directly.

OCR is fully local and opt-in. There is no cloud engine and no API key anywhere: the backend talks
directly to our own OCR image (`ghcr.io/invoicerr-app/ocr-image`, ocrmypdf plus a broad Tesseract
language-pack set — `docker-compose.yml`'s `ocr` service, `--profile ocr`), which reads the PDF and
returns plain text. `ocr-service/local-client.ts` maps that text to the proposal shape with regex
heuristics over amount, date, VAT-id and invoice-number keyword proximity; its own header documents
exactly what that can and cannot get right. Leave `OCR_SERVICE_URL` unset and a scanned PDF is
simply stored with empty fields for a human to fill in.

`apply-ocr-fallback.ts` treats the result as an editable PROPOSAL, never an auto-commit — the
heuristic's limits are an acceptable trade for costing nothing and staying fully offline, precisely
because a human always reviews the pre-filled screen before it is saved.

Adding a new extension point means: define a narrow interface for exactly what callers need, give it
its own small registry (a `Map`, like `receivedDocumentExtractorRegistry`), and register exactly one
real implementation per process (swapped for a fake in tests) — never a generic, DB-configurable
plugin table.

## History

Two mechanisms preceded the one above, both removed:

- A second, EARLIER mechanism let a user install a plugin from a Git URL at runtime
  (`POST /api/plugins` cloned the repository and dynamically `import()`ed its entrypoint). It was
  removed: its `IPlugin` shape (`{__uuid, __filepath, name, description}`) had no real extension
  point behind it — the only two generic consumers a loaded plugin could reach
  (`canGenerateXml`/`generateXml`) were permanent stubs (`return false` / `throw`), so an externally
  installed plugin could not actually do anything. Keeping a code-loading endpoint alive with no
  capability behind it was pure attack surface (arbitrary Git URL → arbitrary code execution in the
  backend process) for zero product value.
- The in-app `PluginRegistry`/`Plugin` mechanism this page used to document in full (see above) —
  its own `STORAGE`/`SIGNING` categories never grew beyond the two providers described above, and
  neither survived to be worth a configurable, per-instance toggle.
