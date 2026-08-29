// DI tokens for the plain (non-Nest) registry instances documents.module.ts constructs and wires
// once. String tokens, matching this codebase's existing convention (see ClientsModule's
// 'VAT_VALIDATION_CLIENT') rather than symbols.
export const DOCUMENT_TYPE_REGISTRY = 'DOCUMENT_TYPE_REGISTRY';
export const FIELD_KIND_REGISTRY = 'FIELD_KIND_REGISTRY';
export const ACTION_REGISTRY = 'ACTION_REGISTRY';
export const ENTITY_REFERENCE_REGISTRY = 'ENTITY_REFERENCE_REGISTRY';
