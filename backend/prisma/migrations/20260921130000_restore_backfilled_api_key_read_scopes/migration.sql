-- Restores read access (and adds write access to the document types that did not exist yet) for API
-- keys that were auto-upgraded by the one-time backfill in
-- 20260705130000_add_api_key_scopes_and_pdf_download_token, and have not been touched since.
--
-- That backfill ran once, when the `scopes` column was introduced, and granted every PRE-EXISTING key
-- exactly five scopes: 'quotes:write', 'invoices:write', 'clients:write', 'articles:write',
-- 'articles:read'. At the time, `hasScope()`/`hasAnyScope()` (backend/src/utils/scope-check.ts) had
-- exactly one real caller in the whole backend — the MCP layer — so that five-scope set was never
-- actually enforced against anything a v1 integration might call: a plain REST API key was effectively
-- unrestricted regardless of what this column said. Since then `@RequiresScope`/
-- `@RequiresDocumentTypeScope` were wired into `AuthGuard` and applied to the REST controllers
-- themselves (~100 handlers) — so a key still carrying exactly that five-scope set now takes a 403 on
-- `GET /clients`, `GET /clients/:id`, `GET /clients/search`, every read-only document route, and every
-- route for a resource declared after that migration (company, api-keys, webhooks, billing,
-- time-tracking).
--
-- This migration is the compatibility fix: it re-grants, to exactly the rows still carrying that exact
-- five-scope set (no more, no less, any order — see the WHERE clause below, which sorts both sides
-- before comparing so insertion order never matters and a set with an extra or missing element never
-- matches), every `:read` scope, plus the `:write` scope of the three document types (`credit-notes`,
-- `expenses`, `received-invoices`) that did not exist yet when the original backfill ran, on top of the
-- `clients:write`/`articles:write` it already held. `quotes:write`/`invoices:write` are re-listed
-- explicitly rather than assumed unchanged, so the SET clause is a complete, self-contained statement
-- of the target state rather than a partial one relying on what was already there.
--
-- A key whose scopes were touched since — the owner narrowing them, or any later write — no longer
-- carries exactly this five-element set, so the WHERE clause already excludes it. That is the whole
-- point of fingerprinting on the exact old set rather than "every key with fewer than N scopes" or
-- similar: a deliberate choice is never overridden by a compatibility migration. An empty scope set
-- (a key created after 20260705130000, which defaults to `[]` — see api-keys.service.ts#create) is
-- excluded the same way: cardinality alone already fails to match.
--
-- Deliberately NOT granted, in every case: 'company:write', 'api-keys:write', 'billing:write',
-- 'webhooks:write', 'time-tracking:write'.
--   - 'api-keys:write' would let a key that could previously do nothing but invoice/quote/client work
--     mint (or revoke) OTHER API keys — restoring v1 compatibility must never hand out MORE power than
--     v1's all-or-nothing model implicitly gave a key's holder over key management itself.
--   - 'company:write' and 'billing:write' gate rewriting company settings and billing/subscription
--     state respectively — compatibility must not become a path to changing what the company IS or is
--     charged.
--   - 'webhooks:write' lets its holder point outbound webhooks at an attacker-chosen URL — a
--     data-exfiltration channel for every document this key can already read, not merely a convenience
--     it would restore.
--   - 'time-tracking:write' gates a resource (backend/src/modules/time-tracking/) that did not exist in
--     v1 at all: no v1 integration can possibly be relying on write access to something that was not
--     there to integrate with, so there is nothing here to "restore".
--
-- The granted scope list below is a SNAPSHOT of `backend/src/modules/api-keys/scopes.ts`'s
-- `API_KEY_SCOPES` as it read on 2026-09-21, written out literally rather than computed, because a
-- migration is a frozen, replayable artifact — it must keep doing exactly this, to exactly these rows,
-- even after `API_KEY_SCOPES` itself later grows a new resource this migration was never told about. A
-- self-hosted instance that upgrades straight to some future version still gets exactly the
-- compatibility grant this migration promised on the day it was written, not whatever the scope list
-- happens to contain by then.
UPDATE "api_key"
SET "scopes" = ARRAY[
  -- every :read scope declared in API_KEY_SCOPES on 2026-09-21
  'articles:read',
  'quotes:read',
  'invoices:read',
  'clients:read',
  'credit-notes:read',
  'expenses:read',
  'received-invoices:read',
  'company:read',
  'api-keys:read',
  'webhooks:read',
  'billing:read',
  'time-tracking:read',
  -- :write for the five document types (quotes/invoices held it already; credit-notes/expenses/
  -- received-invoices did not exist as a resource when the original backfill ran)
  'quotes:write',
  'invoices:write',
  'credit-notes:write',
  'expenses:write',
  'received-invoices:write',
  -- kept from the original backfill, unchanged
  'clients:write',
  'articles:write'
]::TEXT[]
WHERE (
  SELECT array_agg(scope ORDER BY scope) FROM unnest("scopes") AS scope
) = ARRAY['articles:read', 'articles:write', 'clients:write', 'invoices:write', 'quotes:write']::TEXT[];
