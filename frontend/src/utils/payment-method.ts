import type { TFunction } from 'i18next';
import { PaymentMethodType } from '@/types/payment-method';

/**
 * Get localized label for a payment method type
 */
export function getPaymentMethodTypeLabel(
  type: PaymentMethodType,
  t: TFunction,
): string {
  switch (type) {
    case PaymentMethodType.BANK_TRANSFER:
      return t('paymentMethods.fields.type.bank_transfer');
    case PaymentMethodType.PAYPAL:
      return t('paymentMethods.fields.type.paypal');
    case PaymentMethodType.CHECK:
      return t('paymentMethods.fields.type.check');
    case PaymentMethodType.CASH:
      return t('paymentMethods.fields.type.cash');
    case PaymentMethodType.OTHER:
      return t('paymentMethods.fields.type.other');
    default:
      return type;
  }
}
