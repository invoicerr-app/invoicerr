import { resolveRecipientLanguage } from './resolve-recipient-language';
import { RenderLanguage } from './supported-languages';

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
 *
 * The chain is literally the recipient's one, with the person's own locale in the client's seat, so
 * this delegates to it: a second copy of the same three steps could only ever drift.
 */
export function resolveUserLanguage(
  userLocale: string | null | undefined,
  companyLanguage: string | null | undefined,
): RenderLanguage {
  return resolveRecipientLanguage(userLocale, companyLanguage);
}
