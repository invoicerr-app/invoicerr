import { BUILT_IN_PAYMENT_METHODS } from './built-in';
import { PaymentMethodDescriptor } from './types';

/**
 * A method registers itself under an id — the same minimal shape `payments/
 * payment-provider-registry.ts#PaymentProviderRegistry` already holds for the identical "exactly one
 * real implementation per process, resolved by an id a company then picks" problem, and the same
 * shape `transports/transport-registry.ts#TransportRegistry` holds for a document TRANSPORT. Open by
 * design: a plugin registers a new method here under a new id, exactly like a new document type or a
 * new transport would — nothing downstream (persistence.ts, the invoice descriptor's own
 * `record-payment` options, the frontend screen) ever needs to know its id in advance.
 */
export class PaymentMethodRegistry {
  private readonly methods = new Map<string, PaymentMethodDescriptor>();

  register(method: PaymentMethodDescriptor): void {
    if (this.methods.has(method.id)) {
      throw new Error(`A payment method for "${method.id}" is already registered.`);
    }
    this.methods.set(method.id, method);
  }

  /** Every registered method, in registration order — what persistence.ts and the
   *  invoice descriptor's own `record-payment.method` options both iterate. */
  list(): PaymentMethodDescriptor[] {
    return [...this.methods.values()];
  }

  /** Never throws for an unknown id — a legacy `DocumentPayment.method` value this registry never
   *  registered (e.g. "card"/"other", see built-in.ts's own header) is a real, honest outcome a
   *  caller must handle as "no descriptor for this one", never a 500. */
  resolve(id: string): PaymentMethodDescriptor | undefined {
    return this.methods.get(id);
  }
}

export function buildPaymentMethodRegistry(): PaymentMethodRegistry {
  const registry = new PaymentMethodRegistry();
  for (const method of BUILT_IN_PAYMENT_METHODS) {
    registry.register(method);
  }
  return registry;
}

/**
 * The process-wide instance every consumer actually reads — the SAME "one shared, directly-imported
 * catalog" convention `mentions/registry.ts#defaultMentionsCatalog` and
 * `transports/channel-policy/registry.ts#defaultChannelPolicyCatalog` already hold, chosen
 * DELIBERATELY over a DI-only token here: this registry must be reachable from BOTH an `@Injectable()`
 * service (`payment-methods.service.ts`, for the settings screen) AND the plain, DI-free rendering
 * functions (`rendering/render-instance-pdf.ts`, `actions/send-document-email.ts` — the same
 * "extracted so the send paths attach the exact same output" functions `sepaPaymentQrFor`/
 * `legalMentionsFor` already are), which have no Nest injector to pull a DI token from at all. A
 * plugin extending this registry (`.register(...)`) does so on THIS instance — the same "mutate the
 * one shared catalog at boot" shape a plugin loader already uses for `defaultMentionsCatalog`.
 */
export const defaultPaymentMethodRegistry: PaymentMethodRegistry = buildPaymentMethodRegistry();
