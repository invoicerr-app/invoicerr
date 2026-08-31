/**
 * Registers every per-document-type UI extension in this app (see custom-slots.ts for the
 * mechanism this feeds, and custom/invoice-preview-button.tsx for the one real extension today).
 *
 * This file — and, transitively, whatever it imports for a registration side effect — is the ONLY
 * place in the frontend allowed to name a specific document type by id. Everything that CONSULTS
 * the registry (document-list.tsx) only ever asks "is anything registered for (typeId, slot)",
 * exactly the same way field-renderers/index.ts is the one place that registers the core field
 * KINDS while document-field.tsx only ever asks "who renders this kind".
 *
 * Importing this module once (for its side effects, no exports of its own) is what makes a type's
 * custom components available; deleting the import below would silently drop that one type's extra
 * behavior without breaking the generic render for anyone else — the same "additive, never a
 * dependency of the core" property the whole mechanism exists to guarantee.
 */
import "./custom/invoice-preview-button"
import "./custom/received-invoice-upload-button"
import "./custom/received-invoice-download-button"
