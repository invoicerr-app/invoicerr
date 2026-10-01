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
  /** Whether `config`, as it stands, already satisfies every field this method requires — the same
   *  check the backend runs before allowing `enabled: true`. Drives the card's own switch: flipping it
   *  on while this is `false` opens the config dialog instead of sending a PATCH doomed to a 400. */
  configured: boolean
}

/**
 * Issue #416 ("payment methods per client") — mirrors the backend's `GET`/`PATCH
 * /api/payment-methods/clients/:clientId` response shape. `methodIds: []` means UNRESTRICTED: this
 * client is offered every method the COMPANY has enabled, exactly as any client was before this
 * feature existed. A non-empty array narrows the client to exactly those ids (intersected, on the
 * backend, with whatever the company currently has enabled — see persistence.ts#
 * resolveEnabledPaymentMethodPresentations).
 */
export interface ClientPaymentMethodRestriction {
  methodIds: string[]
}
