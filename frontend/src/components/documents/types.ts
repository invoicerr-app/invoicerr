// Mirrors backend/src/modules/documents/descriptors/types.ts. Deliberately duplicated rather than
// shared (front and back are two separate npm projects with no shared package, same as
// DocumentKindRule already did for the — now removed — compliance engine): this is a wire shape,
// not code.

export interface DocumentFieldOption {
  value: string
  label: string
}

export interface DocumentFieldDescriptor {
  key: string
  /** One of the core kinds (see field-renderers/registry.ts), or a plugin-registered one. */
  kind: string
  label: string
  required?: boolean
  helpText?: string
  /** 'select': the choices offered. */
  options?: DocumentFieldOption[]
  /** 'money': a fixed ISO 4217 currency code. Ignored when `currencyField` is set. */
  currency?: string
  /** 'money': the key of a top-level sibling field whose current value is the currency to show. */
  currencyField?: string
  /** 'reference': which entity the generic search/resolve endpoints target (e.g. "client"). */
  entity?: string
  /** 'array': the shape of one row. */
  fields?: DocumentFieldDescriptor[]
  min?: number
  max?: number
}

export interface DocumentActionDescriptor {
  id: string
  label: string
  /** 'always', or the list of record statuses this action is offered for. */
  availableWhen: "always" | string[]
}

export interface DocumentTypeDescriptor {
  id: string
  label: string
  fields: DocumentFieldDescriptor[]
  actions: DocumentActionDescriptor[]
}

export interface DocumentTypeSummary {
  id: string
  label: string
}

export interface DocumentInstance {
  id: string
  typeId: string
  status: string
  data: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface EntityReferenceOption {
  id: string
  label: string
}

export function isActionAvailable(action: DocumentActionDescriptor, status: string | undefined): boolean {
  if (action.availableWhen === "always") return true
  return status !== undefined && action.availableWhen.includes(status)
}
