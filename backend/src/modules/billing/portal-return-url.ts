/**
 * The one shared fallback return URL `billing.controller.ts`'s own `POST /billing/checkout` and
 * `/billing/portal` both need (`checkout-session.ts`/`portal-session.ts`'s own headers) whenever a
 * caller omits its own `successUrl`/`returnUrl` — kept as its own tiny, dependency-free constant
 * rather than duplicated in both call sites.
 */
import { appOrigin } from '@/utils/app-origin';

export const FALLBACK_RETURN_URL = (): string => `${appOrigin()}/settings/billing`;
