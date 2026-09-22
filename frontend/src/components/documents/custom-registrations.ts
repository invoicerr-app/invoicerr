/**
 * Registers every per-document-type UI extension in this app (see custom-slots.ts for the
 * mechanism this feeds, and custom/invoice-correction-routes-button.tsx for a real extension), plus
 * every per-reference-ENTITY "quick create" dialog (reference-create-registry.ts,
 * custom/client-quick-create.tsx) — the same "additive, discovered by id, never a core dependency"
 * shape applied to a different axis (a document TYPE vs. a reference ENTITY a 'reference' field can
 * target), so it lives in the same bootstrap file rather than a second one.
 *
 * This file — and, transitively, whatever it imports for a registration side effect — is the ONLY
 * place in the frontend allowed to name a specific document type OR reference entity by id.
 * Everything that CONSULTS either registry (document-list.tsx, document-detail.tsx,
 * field-renderers/reference-field.tsx) only ever asks "is anything registered for this (typeId,
 * slot) / this entity", exactly the same way field-renderers/index.ts is the one place that
 * registers the core field KINDS while document-field.tsx only ever asks "who renders this kind".
 *
 * Importing this module once (for its side effects, no exports of its own) is what makes a type's
 * custom components — and an entity's quick-create dialog — available; deleting an import below
 * would silently drop that one extra behavior without breaking the generic render for anyone else —
 * the same "additive, never a dependency of the core" property the whole mechanism exists to
 * guarantee.
 */
import "./custom/invoice-correction-routes-button"
import "./custom/received-invoice-upload-button"
import "./custom/received-invoice-download-button"
import "./custom/client-quick-create"
