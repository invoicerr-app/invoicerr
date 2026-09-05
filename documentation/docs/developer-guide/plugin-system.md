---
sidebar_position: 2
---

# Plugin System

Invoicerr has **one** plugin mechanism today: in-app plugins, managed by the `plugins` module
(`backend/src/modules/plugins/`). A second mechanism — loading third-party code from a Git URL at
runtime — existed and was removed (see [History](#history) below).

## In-app plugins

Built-in plugins for a fixed set of types: `SIGNING`, `STORAGE` (`PDF_FORMAT`, `OIDC`, and `OCR`
are declared in the `PluginType` enum but have no registered provider yet — see the Prisma schema
comment on `PluginType` for why they're left in place unused). They are registered on startup by a
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
(`backend/src/plugins/ocr/providers/mistral/mistral.ts`). Read that provider file's own header for
the full account of why it does **not** go through `PluginRegistry`: the credential/engine is held
only by a dedicated docker-compose service (`ROLE=ocr`), reached by the backend through
`OCR_SERVICE_URL` alone — never a `Plugin` row, never the Settings screen. A test double
(`FakeReceivedInvoiceOcrExtractor`) is registered instead under `NODE_ENV=test`, the same swap
discipline `clients.module.ts`'s `VAT_VALIDATION_FAKE` already establishes elsewhere in this
codebase.

That `ROLE=ocr` service itself supports TWO engines, picked by its own `OCR_ENGINE` env var — the
main backend never knows or cares which one is behind `OCR_SERVICE_URL`:

- `OCR_ENGINE=mistral` (the default) — Mistral Document AI, a cloud API, needs `MISTRAL_API_KEY`.
  Structured extraction: the model itself answers a JSON schema (`ocr-service/mistral-client.ts`).
- `OCR_ENGINE=local` — MANDANT DECISION (verbatim): *"J'ai pas de clé Mistral, pour moi en local
  faut lancer un service Docker qui fait ça."* No API key, no data ever leaves the instance. Calls
  a second, self-hosted container (`apache/tika:latest-full`, `docker-compose.yml`'s own
  `ocr-local`/`tika` services) that reads the PDF and OCRs it itself, then maps the resulting PLAIN
  TEXT to the same proposal shape with regex heuristics (amount/date/VAT-id/invoice-number keyword
  proximity — `ocr-service/local-client.ts`). Meaningfully weaker than the cloud path by design —
  that file's own header documents exactly what it can and cannot get right, and why Tika was
  chosen over a bare Tesseract-server image (short version: Tika reads a PDF natively, so this
  stays a bare `fetch` with no new dependency; Tesseract does not read PDF at all).

Either way, `apply-ocr-fallback.ts` treats the result as an editable PROPOSAL, never an auto-commit
— the local engine's weaker accuracy is an acceptable trade for costing nothing and staying fully
offline, precisely because a human always reviews the pre-filled screen before it is saved.

Adding a new extension point means: define a narrow interface for exactly what callers need,
give it its own small registry (a `Map`, like `receivedDocumentExtractorRegistry`), and register
exactly one real implementation per process (swapped for a fake in tests) — not routing through
`PluginRegistry` unless the capability is genuinely instance-wide, single-active-provider,
company-agnostic, like signing or storage are.

## History

Earlier, a second mechanism let a user install a plugin from a Git URL at runtime
(`POST /api/plugins` cloned the repository and dynamically `import()`ed its entrypoint). It was
**removed** (TODO_SUITE.md P2): its `IPlugin` shape (`{__uuid, __filepath, name, description}`) had
no real extension point behind it — the only two generic consumers a loaded plugin could reach
(`canGenerateXml`/`generateXml`) were permanent stubs (`return false` / `throw`), so an externally
installed plugin could not actually do anything. Keeping a code-loading endpoint alive with no
capability behind it was pure attack surface (arbitrary Git URL → arbitrary code execution in the
backend process) for zero product value. See `TODO_ISSUES.md`, "Le système de plugins, vu par son
premier vrai consommateur" for the investigation that led to this decision, and the section above
for the extensibility path that replaces it. Nothing about in-app plugins changed.
