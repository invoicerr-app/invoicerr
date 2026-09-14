import type { DocumentFieldDescriptor } from "@/components/documents/types"

/**
 * Mirrors the backend's `payment-methods/persistence.ts#PaymentMethodConfigView` — one entry per
 * registered method (payment-methods/built-in.ts), always the FULL list, configured or not: `GET
 * /api/payment-methods` never filters down to only the enabled ones, the same "the screen offers
 * every method it could, not just the ones already on" reasoning that endpoint's own header holds.
 *
 * `fields` reuses the exact same `DocumentFieldDescriptor` vocabulary a document's own fields (and an
 * action's own params) already use — rendered by the SAME `DocumentField` components the action-params
 * dialog already uses (see payment-methods/index.tsx), never a second form system.
 */
export interface PaymentMethodConfig {
  id: string
  label: string
  fields: DocumentFieldDescriptor[]
  enabled: boolean
  config: Record<string, unknown>
}
