import { BadRequestException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';
import {
  RenderLanguage,
  SUPPORTED_RENDER_LANGUAGES,
  isSupportedRenderLanguage,
} from '@/modules/documents/rendering/language/supported-languages';

/**
 * `PATCH /api/auth-extended/preferences`'s own validation. No `ValidationPipe`/class-validator runs
 * anywhere in this API (see `legal.dto.ts`'s own header on `parseAcceptLegalSlugs`), so the shape/
 * value check lives here, called from the controller before anything is written — `null` clears the
 * preference (falls back to `Company.language`, then 'en', at read time — `resolve-user-language.ts`);
 * anything else must already be one of `SUPPORTED_RENDER_LANGUAGES`.
 *
 * Deliberately stricter than sign-up's own best-effort value (`signup-locale.ts`'s
 * `normalizeSignupLocale`, which silently drops an unsupported one to `null`): a caller reaching THIS
 * endpoint chose the value on purpose, from the account preferences screen's own dropdown — built off
 * this exact list — so an unsupported value here is a caller bug, refused loudly (400) instead of
 * swallowed.
 */
export function parseAccountLocaleInput(
  body: { locale?: unknown } | null | undefined,
): RenderLanguage | null {
  if (!body || !('locale' in body)) {
    throw new BadRequestException('locale is required (a supported language code, or null to clear it)');
  }

  const { locale } = body;
  if (locale === null) return null;

  if (typeof locale !== 'string' || !isSupportedRenderLanguage(locale.trim().toLowerCase())) {
    throw new BadRequestException(
      `locale must be one of ${SUPPORTED_RENDER_LANGUAGES.join(', ')}, or null to clear it`,
    );
  }

  return locale.trim().toLowerCase() as RenderLanguage;
}

/**
 * The write half — `parseAccountLocaleInput` has already validated by the time this runs. Returns the
 * value actually persisted (read back off the `update` result, not merely echoed) so a caller never
 * reports success on the strength of its own input alone.
 */
export async function setUserLocale(
  userId: string,
  locale: RenderLanguage | null,
): Promise<RenderLanguage | null> {
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { locale },
    select: { locale: true },
  });
  return updated.locale as RenderLanguage | null;
}
