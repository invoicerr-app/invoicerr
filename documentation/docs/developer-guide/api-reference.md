---
sidebar_position: 99
---

# API Reference

Invoicerr's backend exposes a fully documented REST API via [Swagger/OpenAPI](https://swagger.io/), generated from `@nestjs/swagger` decorators on every controller in `backend/src/modules/`.

Rather than duplicating that reference here, use the live, always-up-to-date Swagger UI served by your own Invoicerr instance:

- **Interactive UI**: `https://<your-instance>/api/docs`
- **Raw OpenAPI spec (JSON)**: `https://<your-instance>/api/docs-json`

For a local development setup (see [Local Development](../getting-started/local-development.md)), this is typically:

- `http://localhost:3000/api/docs`
- `http://localhost:3000/api/docs-json`

## Authentication

Most endpoints require either a session cookie (browser login) or an API key. See [Authentication](authentication.md) for details on both mechanisms, and the `api-keys` module for managing keys from the UI.
