import { PaymentMethodDescriptor } from './types';

/**
 * "Cash" — the empty case: NO company-level field at all. "cash just says it's cash, nothing
 * more" (the owner's own brief) — the method's own `label` already says everything there is to say;
 * `present()` never has anything to append below it. This is what proves the architecture handles a
 * method with zero configuration honestly (an empty `fields` array renders an empty form — no dead
 * "nothing to configure" placeholder needed on the frontend, see payment-methods/index.tsx) rather
 * than as a special case every consumer has to know about.
 *
 * `id: 'cash'` is REUSED, unchanged, from the four hardcoded labels `record-payment` used to offer
 * (invoice.descriptor.ts, before this feature) — an existing `DocumentPayment.method === 'cash'` row
 * resolves to this exact descriptor with no migration of its own data needed at all.
 */
export const cashPaymentMethod: PaymentMethodDescriptor = {
  id: 'cash',
  label: 'Cash',
  fields: [],
  present() {
    return { id: 'cash', label: 'Cash', lines: [] };
  },
};
