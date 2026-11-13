/**
 * Lets a write through `CompanyWriteGuard` even for a blocked/zipped company. Checkout and portal need
 * it: they are the only way a blocked company can pay its way out, so gating them would lock it out for good.
 */
import { SetMetadata } from '@nestjs/common';

export const BILLING_GATE_EXEMPT_KEY = 'billing:writeGateExempt';

export const BillingGateExempt = (): ReturnType<typeof SetMetadata> =>
  SetMetadata(BILLING_GATE_EXEMPT_KEY, true);
