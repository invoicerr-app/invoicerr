import { PaymentMethodDescriptor, presentFromFields } from './types';

/**
 * "Bank transfer" — IBAN/BIC. `id`/the field KEYS deliberately mirror `Company.iban`/`Company.bic`
 * (schema.prisma) — the columns the pre-existing SEPA-QR feature (rendering/sepa-qr.ts) and
 * XRechnung's own BR-DE-1 payment-instructions group (formats/xrechnung-provider.ts) already read.
 * `persistence.ts` bridges THIS method's config reads/writes to those two columns instead
 * of the generic `CompanyPaymentMethodConfig` row every other method gets — see that file's own
 * header for the "one fact, one place" reasoning (a company typing its IBAN once, not once per
 * feature that happens to need it). This descriptor stays ignorant of that bridge: it only ever sees
 * whatever `config` object it is handed, the exact same shape every other method receives.
 *
 * `id: 'bank_transfer'` is REUSED, unchanged, from the four hardcoded labels `record-payment` used to
 * offer (invoice.descriptor.ts, before this feature) — an existing `DocumentPayment.method ===
 * 'bank_transfer'` row therefore resolves to this exact descriptor with no migration of its own data
 * needed at all.
 */
export const bankTransferPaymentMethod: PaymentMethodDescriptor = {
  id: 'bank_transfer',
  label: 'Bank transfer',
  fields: [
    { key: 'iban', kind: 'text', label: 'IBAN', required: true },
    { key: 'bic', kind: 'text', label: 'BIC', required: false },
  ],
  present(ctx) {
    return presentFromFields(bankTransferPaymentMethod, ctx.config);
  },
};
