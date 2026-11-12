import { appOrigin } from '@/utils/app-origin';

/** Used by checkout and portal when the caller omits its own `successUrl`/`returnUrl`. */
export const FALLBACK_RETURN_URL = (): string => `${appOrigin()}/settings/billing`;
