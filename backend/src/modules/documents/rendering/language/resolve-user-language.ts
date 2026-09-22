import { resolveDefaultLocale } from './default-locale';
import { DEFAULT_RENDER_LANGUAGE, isSupportedRenderLanguage, RenderLanguage } from './supported-languages';

function normalize(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim().toLowerCase();
  return trimmed ? trimmed : undefined;
}

/**
 * The language a PERSON (not a document recipient — see `resolveRecipientLanguage` for that one)
 * reads the product in, and receives their own mail in — every mail addressed to a specific,
 * authenticated user (danger-zone OTP, data export, ownership transfer, legal-document-changed
 * notice) resolves it through this function before building the mail. Mirrors `resolveRecipientLanguage`'s
 * own three-step chain:
 *
 *  1. `userLocale` (`User.locale`) — set at sign-up (best-effort, from the browser) or deliberately
 *     via `PATCH /api/auth-extended/preferences`. Authoritative when it names a language this render
 *     layer actually carries strings for.
 *  2. `companyLanguage` (`Company.language`) — the same fallback `resolveRecipientLanguage` already
 *     uses for a client with no language of its own, reused here so a user who never set a personal
 *     preference still lands on their company's language rather than jumping straight to English.
 *  3. `DEFAULT_LOCALE` (`resolveDefaultLocale`) — the same instance-wide env var
 *     `resolveRecipientLanguage` consults at the same position in its own chain, for a user who set no
 *     personal locale in a company that itself never set one either. See that function's own header.
 *  4. `DEFAULT_RENDER_LANGUAGE` ('en').
 *
 * Case-insensitive and whitespace-tolerant on the way in, same as `resolveRecipientLanguage` — the
 * return value is always one of the six canonical lowercase codes `supported-languages.ts` names.
 */
export function resolveUserLanguage(
  userLocale: string | null | undefined,
  companyLanguage: string | null | undefined,
): RenderLanguage {
  const user = normalize(userLocale);
  if (isSupportedRenderLanguage(user)) return user;

  const company = normalize(companyLanguage);
  if (isSupportedRenderLanguage(company)) return company;

  return resolveDefaultLocale() ?? DEFAULT_RENDER_LANGUAGE;
}
