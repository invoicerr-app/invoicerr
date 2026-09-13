---
sidebar_position: 2
---

# Plugin System

Invoicerr has **one** plugin mechanism today: in-app plugins, managed by the `plugins` module
(`backend/src/modules/plugins/`). A second mechanism — loading third-party code from a Git URL at
runtime — existed and was removed (see [History](#history) below).

## In-app plugins

Built-in plugins for a fixed set of types: `SIGNING` and `STORAGE`. A third value, `OCR`, is declared
in the `PluginType` enum but has no registered provider — the Prisma schema comment on `PluginType`
explains why it is left in place unused (OCR ended up as a dedicated docker-compose service, and
dropping a value from a live Postgres enum means rebuilding the whole type). `PDF_FORMAT` and `OIDC`
are **not** plugin types: neither is declared in the enum, and neither is pluggable — the PDF format
is a per-company setting and OIDC is configured through environment variables and the SSO settings
screen. They are named here only because earlier revisions of this page claimed otherwise.

They are registered on startup by a
`PluginRegistry` singleton (`backend/src/plugins/index.ts`) and stored in the database (the
`Plugin` table) with an on/off toggle and an optional configuration form.

- Only one active plugin per type, except `STORAGE` which supports multiple active instances
  (`PluginRegistry.multiInstancePluginTypes`).
- Examples: an S3 provider and a local-disk provider for storage
  (`backend/src/plugins/storage/providers/`).
- Settings screen: `frontend/src/pages/(app)/settings/_components/plugins.settings.tsx`.

### Activation flow

1. A user toggles an in-app plugin via `PUT /api/plugins/in-app/toggle`.
2. If the plugin requires configuration, the API returns a form schema and defers activation.
3. The user submits the config via `POST /api/plugins/in-app/configure`.
4. The system validates the plugin, generates a webhook URL/secret if the plugin implements
   `handleWebhook()`, and persists it.

## Plugin interface

Defined in `backend/src/plugins/types.ts`. Every plugin implements `IPlugin` (`id`, `name`,
optional `validatePlugin()`, optional `handleWebhook()`).

## Inbound plugin webhooks

External services (e.g. a signing provider completing a signature) call back via
`POST /api/webhooks/:pluginId`, an anonymous endpoint. The system verifies the plugin exists and is
active, then forwards the request to the plugin's `handleWebhook()` implementation.

## Extending the application: the narrow-interface-at-the-core pattern

For a capability that isn't a good fit for `PluginRegistry` — a per-company credential rather than
an instance-wide toggle, a background service with its own lifecycle, or simply a case where the
"one active provider per type" rule doesn't apply — the pattern used elsewhere in this codebase is
a **narrow interface at the core, with a registry the feature itself owns**, not the generic
`PluginRegistry`/`Plugin` table machinery.

The reference example is received-document OCR extraction (`ReceivedDocumentExtractor`,
`backend/src/modules/documents/received-invoices/ocr/extractor.ts`) and its implementation
(`backend/src/plugins/ocr/providers/local/local.ts`). It does **not** go through `PluginRegistry`:
its whole configuration is one environment variable, `OCR_SERVICE_URL`, naming a container — never a
`Plugin` row, never the Settings screen. A test double (`FakeReceivedInvoiceOcrExtractor`) is
registered instead under `NODE_ENV=test`, the same swap discipline `clients.module.ts`'s
`VAT_VALIDATION_FAKE` already establishes elsewhere in this codebase.

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

Adding a new extension point means: define a narrow interface for exactly what callers need,
give it its own small registry (a `Map`, like `receivedDocumentExtractorRegistry`), and register
exactly one real implementation per process (swapped for a fake in tests) — not routing through
`PluginRegistry` unless the capability is genuinely instance-wide, single-active-provider,
company-agnostic, like signing or storage are.

## History

Earlier, a second mechanism let a user install a plugin from a Git URL at runtime
(`POST /api/plugins` cloned the repository and dynamically `import()`ed its entrypoint). It was
**removed**: its `IPlugin` shape (`{__uuid, __filepath, name, description}`) had
no real extension point behind it — the only two generic consumers a loaded plugin could reach
(`canGenerateXml`/`generateXml`) were permanent stubs (`return false` / `throw`), so an externally
installed plugin could not actually do anything. Keeping a code-loading endpoint alive with no
capability behind it was pure attack surface (arbitrary Git URL → arbitrary code execution in the
backend process) for zero product value. See `TODO_ISSUES.md`, "Le système de plugins, vu par son
premier vrai consommateur" for the investigation that led to this decision, and the section above
for the extensibility path that replaces it. Nothing about in-app plugins changed.
