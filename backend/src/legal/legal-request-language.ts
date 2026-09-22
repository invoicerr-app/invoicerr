/**
 * Builds the ORDERED language-preference list `GET /legal/documents` resolves every document
 * against (`legal-document-view.ts#resolveLegalDocumentView` picks the first entry that names a
 * language the document actually has a translation for). Priority, highest first:
 *
 *  1. An explicit `?lang=` query param — the frontend's own selector
 *     (`pages/legal/[slug].tsx`/`accept.tsx`) sends this the moment a visitor picks a language by
 *     hand. A deliberate, one-off choice for THIS view must win over even a standing account
 *     preference, which the visitor may not remember having set.
 *  2. The signed-in caller's own `User.locale`, via a SOFT session lookup — this route stays
 *     `@Public()` (self-hosted, no-session reachability — `legal.controller.ts`'s own header), so a
 *     session cookie is a BONUS signal when present, never a requirement: `getSession` returning
 *     nothing, throwing, or the user having no `locale` set all fall through to the next signal
 *     rather than failing the request. Read straight off `prisma.user` rather than off
 *     `session.user` — better-auth's own session payload does not carry app-specific columns unless a
 *     plugin explicitly adds them, and this module has no reason to depend on whether one does.
 *  3. The browser's own `Accept-Language` header.
 *  4. `'en'` — always appended, so `resolveLegalDocumentView` never has to handle "nothing matched"
 *     as a separate case; every document has an English text by construction.
 */
import { fromNodeHeaders } from 'better-auth/node';

import { auth } from '@/lib/auth';
import prisma from '@/prisma/prisma.service';

import {
  DEFAULT_LEGAL_DOCUMENT_LANGUAGE,
  isLegalDocumentLanguage,
  parseAcceptLanguageHeader,
} from './legal-languages';

/** The one shape this module needs from an Express `Request` — narrowed so its spec can pass a plain
 *  object instead of constructing a real one, the same minimal-surface convention
 *  `legal-acceptance.ts`'s own `AcceptanceMeta` uses for the same reason. */
export interface LanguageAwareRequest {
  headers: Record<string, string | string[] | undefined>;
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * A session lookup failing outright (malformed cookie, a transient DB hiccup) must never break this
 * public route — it only ever costs the caller this ONE soft personalization signal, never the
 * request itself, which is why every failure mode here resolves to `null` rather than rejecting.
 */
async function tryResolveSessionLocale(request: LanguageAwareRequest): Promise<string | null> {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(request.headers as Record<string, string>),
    });
    if (!session) return null;

    const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { locale: true } });
    return user?.locale && isLegalDocumentLanguage(user.locale) ? user.locale : null;
  } catch {
    return null;
  }
}

export async function resolveLegalDocumentLanguages(
  request: LanguageAwareRequest,
  explicitLang: string | undefined,
): Promise<string[]> {
  const candidates: string[] = [];

  if (explicitLang && isLegalDocumentLanguage(explicitLang)) candidates.push(explicitLang);

  const sessionLocale = await tryResolveSessionLocale(request);
  if (sessionLocale) candidates.push(sessionLocale);

  candidates.push(...parseAcceptLanguageHeader(firstHeaderValue(request.headers['accept-language'])));
  candidates.push(DEFAULT_LEGAL_DOCUMENT_LANGUAGE);

  return candidates;
}
