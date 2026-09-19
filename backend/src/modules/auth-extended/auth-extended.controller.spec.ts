/**
 * `POST /api/auth-extended/set-password` under OIDC_ONLY.
 *
 * This is the half of the flag that is easy to forget and fatal to omit: better-auth does NOT gate
 * `setPassword`/`changePassword` behind `emailAndPassword.enabled`, so on an instance configured for
 * single sign-on a signed-in user could otherwise mint themselves a password here and walk back in
 * through the door the operator believed was shut — the flag would be cosmetic, and hiding the card in
 * the account screen would be the only thing standing in the way.
 *
 * `@/lib/auth` is mocked: importing it for real builds a live Prisma adapter at import time and pulls
 * in `dotenv/config`, neither of which a controller-level decision needs. The mock also makes the
 * "never reached better-auth" assertion possible, which is the point — a refusal that still called
 * `setPassword` first would not be a refusal.
 */
import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';

import { auth } from '@/lib/auth';
import { CurrentUser } from '@/types/user';
import { AuthExtendedController } from './auth-extended.controller';
import { setUserLocale } from './preferences';

jest.mock('@/lib/auth', () => ({
  __esModule: true,
  auth: { api: { setPassword: jest.fn().mockResolvedValue({}) } },
}));

// `preferences.ts` reaches through to the shared `prisma` singleton — mocked at THAT boundary
// (`preferences.spec.ts` covers `setUserLocale`/`parseAccountLocaleInput` on their own), so this file
// only has to prove the controller wires the two together correctly.
jest.mock('./preferences', () => {
  const actual = jest.requireActual('./preferences');
  return { ...actual, setUserLocale: jest.fn() };
});

const setPasswordApi = (auth as unknown as { api: { setPassword: jest.Mock } }).api.setPassword;
const mockSetUserLocale = setUserLocale as jest.Mock;
const request = { headers: {} } as unknown as Request;
const currentUser = { id: 'user-1' } as CurrentUser;

const LONG_ENOUGH = 'a-long-enough-password';

describe('AuthExtendedController#setPassword', () => {
  let controller: AuthExtendedController;
  let savedOidcOnly: string | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    setPasswordApi.mockResolvedValue({});
    controller = new AuthExtendedController();
    savedOidcOnly = process.env.OIDC_ONLY;
  });

  afterEach(() => {
    // `process.env` is shared across every spec in a Jest worker, and OIDC_ONLY being left set would
    // silently disable email/password for whatever ran next.
    if (savedOidcOnly === undefined) delete process.env.OIDC_ONLY;
    else process.env.OIDC_ONLY = savedOidcOnly;
  });

  describe('on a single-sign-on-only instance', () => {
    it('refuses outright, without ever calling better-auth', async () => {
      process.env.OIDC_ONLY = '1';

      await expect(controller.setPassword(request, { newPassword: LONG_ENOUGH })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(setPasswordApi).not.toHaveBeenCalled();
    });

    it('names OIDC_ONLY in the refusal, so an operator can tell it from a rejected password', async () => {
      process.env.OIDC_ONLY = 'true';

      await expect(controller.setPassword(request, { newPassword: LONG_ENOUGH })).rejects.toThrow(
        /OIDC_ONLY/,
      );
    });

    it('refuses BEFORE the length check, so the closed door is not also a password-rules oracle', async () => {
      process.env.OIDC_ONLY = '1';

      await expect(controller.setPassword(request, { newPassword: 'short' })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('on an ordinary instance (the default)', () => {
    it('still sets a password (mutation check: the refusal is opt-in, not unconditional)', async () => {
      delete process.env.OIDC_ONLY;

      await expect(controller.setPassword(request, { newPassword: LONG_ENOUGH })).resolves.toEqual({
        success: true,
        message: 'Password set successfully',
      });
      expect(setPasswordApi).toHaveBeenCalledTimes(1);
    });

    it.each(['0', 'false', ''])('still sets a password with OIDC_ONLY=%p', async (value) => {
      process.env.OIDC_ONLY = value;

      await expect(controller.setPassword(request, { newPassword: LONG_ENOUGH })).resolves.toMatchObject({
        success: true,
      });
    });

    it('still rejects a too-short password, unchanged', async () => {
      delete process.env.OIDC_ONLY;

      await expect(controller.setPassword(request, { newPassword: 'short' })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(setPasswordApi).not.toHaveBeenCalled();
    });
  });
});

/**
 * `PATCH /api/auth-extended/preferences` — `locale` is the account's own "Mon compte" language
 * preference, exposed to the rest of the app through the session (`User.locale`, an additionalField
 * on better-auth's `user` config — see `lib/auth.ts`'s own `customSession`, which passes `user`
 * through untouched, so a field this endpoint just wrote is exactly what the NEXT `get-session` call
 * (and thus `CurrentUser`/`@User()` everywhere else) reads back).
 */
describe('AuthExtendedController#updatePreferences', () => {
  let controller: AuthExtendedController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new AuthExtendedController();
  });

  it('persists a supported locale and echoes back what was actually written', async () => {
    mockSetUserLocale.mockResolvedValue('fr');

    await expect(controller.updatePreferences(currentUser, { locale: 'FR' })).resolves.toEqual({
      success: true,
      locale: 'fr',
    });
    // Normalized (lowercased) BEFORE reaching the write — the write never has to know about casing.
    expect(mockSetUserLocale).toHaveBeenCalledWith('user-1', 'fr');
  });

  it('accepts null to clear the preference', async () => {
    mockSetUserLocale.mockResolvedValue(null);

    await expect(controller.updatePreferences(currentUser, { locale: null })).resolves.toEqual({
      success: true,
      locale: null,
    });
    expect(mockSetUserLocale).toHaveBeenCalledWith('user-1', null);
  });

  it('rejects an unsupported locale with a 400, and never reaches the write', async () => {
    await expect(controller.updatePreferences(currentUser, { locale: 'es' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(mockSetUserLocale).not.toHaveBeenCalled();
  });

  it('rejects a body with no `locale` key at all with a 400 — never a silent no-op', async () => {
    await expect(controller.updatePreferences(currentUser, {})).rejects.toBeInstanceOf(BadRequestException);
    expect(mockSetUserLocale).not.toHaveBeenCalled();
  });
});
