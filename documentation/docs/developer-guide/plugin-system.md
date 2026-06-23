---
sidebar_position: 2
---

# Plugin System

Invoicerr supports two kinds of plugins, both managed by the `plugins` module (`backend/src/modules/plugins/`).

## In-app plugins

Built-in plugins for a fixed set of types: `SIGNING`, `STORAGE`, `PDF_FORMAT`, `OIDC`. They are registered on startup by a `PluginRegistry` singleton (`backend/src/plugins/index.ts`) and stored in the database with an on/off toggle and an optional configuration form.

- Only one active plugin per type, except `STORAGE` which supports multiple active instances.
- Examples: a Documenso provider for signing, an S3 provider for storage.

### Activation flow

1. A user toggles an in-app plugin via `PUT /api/plugins/in-app/toggle`.
2. If the plugin requires configuration, the API returns a form schema and defers activation.
3. The user submits the config via `POST /api/plugins/in-app/configure`.
4. The system validates the plugin, generates a webhook URL/secret if the plugin implements `handleWebhook()`, and persists it.

## External plugins

Git-based plugins that users install by URL:

1. A user clones a plugin repo via `POST /api/plugins` with a Git URL.
2. The system loads the plugin's JS entrypoint and instantiates its default export.
3. The plugin is registered in memory with a UUID and name, with an optional init hook.

## Plugin interface

Defined in `backend/src/plugins/types.ts`. Every plugin implements `IPlugin` (`id`, `name`, optional `validatePlugin()`, optional `handleWebhook()`). Signing providers additionally implement signature/PDF generation hooks.

## Inbound plugin webhooks

External services (e.g. a signing provider completing a signature) call back via `POST /api/webhooks/:pluginId`, an anonymous endpoint. The system verifies the plugin exists and is active, then forwards the request to the plugin's `handleWebhook()` implementation.
