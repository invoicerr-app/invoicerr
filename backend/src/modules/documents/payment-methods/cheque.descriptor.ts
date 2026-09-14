import { PaymentMethodDescriptor, presentFromFields } from './types';

/**
 * "Cheque" — a single field, the classic "pay to the order of" name a payer writes the cheque out to.
 * No link, no amount-aware behavior: a cheque is handed over or mailed, never followed through a URL.
 */
export const chequePaymentMethod: PaymentMethodDescriptor = {
  id: 'cheque',
  label: 'Cheque',
  fields: [
    {
      key: 'payee',
      kind: 'text',
      label: 'Payee',
      required: true,
      helpText: 'The name a cheque should be made out to — "pay to the order of".',
    },
  ],
  present(ctx) {
    return presentFromFields(chequePaymentMethod, ctx.config);
  },
};
