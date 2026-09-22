import type { ComponentType } from "react"

/**
 * Props every registered "quick create" component receives — the same generic contract
 * `field-renderers/registry.ts` already holds for a field KIND, applied here to reference ENTITIES
 * instead: a component registered below never needs the picker that opens it (SearchSelect, driven
 * by reference-field.tsx) to know anything about its own shape.
 */
export interface ReferenceCreateComponentProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * Fires once the created record exists, with its bare id — never a label. The 'reference' field
   * that opened this already resolves an id into its display label through the generic
   * `/api/documents/references/:entity/:id` endpoint (`useReferenceResolve`), the exact same path
   * every other already-set reference value goes through, so a quick-create component never has to
   * duplicate that formatting just to hand back what it made.
   */
  onCreated: (id: string) => void
}

export type ReferenceCreateComponent = ComponentType<ReferenceCreateComponentProps>

/**
 * Open registry, entity -> its own "create one, right here" dialog — the same shape
 * `field-renderers/registry.ts` holds for field KINDS, applied to reference ENTITIES instead. A
 * 'reference' field whose `entity` has nothing registered here simply offers no "+ Create new…"
 * option (reference-field.tsx's own lookup falls back to `undefined`) — additive, never a
 * requirement every entity must meet.
 */
const REFERENCE_CREATE_COMPONENTS = new Map<string, ReferenceCreateComponent>()

export function registerReferenceCreateComponent(entity: string, component: ReferenceCreateComponent): void {
  REFERENCE_CREATE_COMPONENTS.set(entity, component)
}

export function getReferenceCreateComponent(entity: string): ReferenceCreateComponent | undefined {
  return REFERENCE_CREATE_COMPONENTS.get(entity)
}
