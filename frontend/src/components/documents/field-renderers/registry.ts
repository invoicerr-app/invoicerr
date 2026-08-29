import type { ComponentType } from "react"

import type { DocumentFieldDescriptor } from "@/components/documents/types"

export interface FieldRendererProps {
  field: DocumentFieldDescriptor
  /** react-hook-form path for this field — e.g. "notes", or "lines.0.description" for a row field. */
  name: string
}

export type FieldRendererComponent = ComponentType<FieldRendererProps>

/**
 * Open registry of field-KIND renderers, keyed by kind name. This is the entire reason
 * DocumentField (../document-field.tsx) never has a switch on the document TYPE: it only ever asks
 * "who renders this KIND", and a plugin extends the set by calling registerFieldRenderer() with a
 * prefixed kind name (e.g. "plugin:acme.rating") before any form using it is rendered — see
 * field-renderers/index.ts for where the 9 core kinds are registered this same way.
 */
const FIELD_RENDERERS = new Map<string, FieldRendererComponent>()

export function registerFieldRenderer(kind: string, component: FieldRendererComponent): void {
  FIELD_RENDERERS.set(kind, component)
}

export function getFieldRenderer(kind: string): FieldRendererComponent | undefined {
  return FIELD_RENDERERS.get(kind)
}
