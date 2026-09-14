import { Injectable } from '@nestjs/common';

import {
  listCompanyPaymentMethods,
  PaymentMethodConfigView,
  UpdatePaymentMethodConfigInput,
  updateCompanyPaymentMethodConfig,
} from './persistence';

/**
 * The settings-screen half of payment-methods/ — a thin `@Injectable()` wrapper around
 * persistence.ts's own plain functions, the same split `PaymentSessionsService` draws from
 * `payment-sessions.persistence.ts`. Kept as a real Nest service (rather than the controller calling
 * persistence.ts directly) purely for consistency with every other controller in this codebase
 * (`Controller → Service → Prisma`) — persistence.ts itself is what the plain rendering pipeline
 * (`rendering/render-instance-pdf.ts`, `actions/send-document-email.ts`) reaches for directly, since
 * neither has a Nest injector to pull this class from.
 */
@Injectable()
export class PaymentMethodsService {
  listForCompany(companyId: string): Promise<PaymentMethodConfigView[]> {
    return listCompanyPaymentMethods(companyId);
  }

  updateConfig(
    companyId: string,
    methodId: string,
    input: UpdatePaymentMethodConfigInput,
  ): Promise<PaymentMethodConfigView> {
    return updateCompanyPaymentMethodConfig(companyId, methodId, input);
  }
}
