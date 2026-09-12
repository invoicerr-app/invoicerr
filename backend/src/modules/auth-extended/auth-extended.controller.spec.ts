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
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';

import { auth } from '@/lib/auth';
import { AuthExtendedController } from './auth-extended.controller';

jest.mock('@/lib/auth', () => ({
  __esModule: true,
  auth: { api: { setPassword: jest.fn().mockResolvedValue({}) } },
}));

const setPasswordApi = (auth as unknown as { api: { setPassword: jest.Mock } }).api.setPassword;
const request = { headers: {} } as unknown as Request;

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
