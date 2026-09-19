import { SetMetadata } from '@nestjs/common';

/**
 * The one escape hatch `LegalAcceptanceGuard` (`legal-acceptance.guard.ts`) checks — mirrors
 * `modules/billing/billing-gate-exempt.decorator.ts`'s own shape (a single boolean metadata flag read
 * via `Reflector.getAllAndOverride`) for the identical reason that guard needs one: a route that is
 * ITSELF the way out of the very state the guard enforces must stay reachable regardless of that state.
 * Here, that route is exactly one: `POST /legal/accept` — without this, a user with a pending
 * acceptance could never call the one endpoint that clears it.
 */
export const LEGAL_GATE_EXEMPT_KEY = 'legalGateExempt';
export const LegalGateExempt = () => SetMetadata(LEGAL_GATE_EXEMPT_KEY, true);
