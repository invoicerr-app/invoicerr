// Same mocking convention as `guards/auth.guard.spec.ts` (see that file's own header): `better-auth/
// node` ships ESM-only and this project's Jest config doesn't transform it, so importing this module
// for real would fail with "Cannot use import statement outside a module" before a single test runs.
// The real `fromNodeHeaders` only reshapes a headers object for `auth.api.getSession`, whose own mock
// below ignores its argument entirely — an identity stub changes nothing this file tests.
jest.mock('better-auth/node', () => ({
  fromNodeHeaders: jest.fn((headers: unknown) => headers),
}));

const getSession = jest.fn();
jest.mock('@/lib/auth', () => ({
  auth: { api: { getSession: (...args: unknown[]) => getSession(...args) } },
}));

jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: { user: { findUnique: jest.fn() } },
}));

import prisma from '@/prisma/prisma.service';
import { resolveLegalDocumentLanguages } from './legal-request-language';

const findUnique = prisma.user.findUnique as jest.Mock;

beforeEach(() => {
  getSession.mockReset().mockResolvedValue(null);
  findUnique.mockReset().mockResolvedValue(null);
});

function request(headers: Record<string, string | string[] | undefined> = {}) {
  return { headers };
}

describe('resolveLegalDocumentLanguages', () => {
  it('ends with "en" even when every other signal is absent', async () => {
    await expect(resolveLegalDocumentLanguages(request(), undefined)).resolves.toEqual(['en']);
  });

  it('an explicit ?lang= comes first, ahead of Accept-Language', async () => {
    const result = await resolveLegalDocumentLanguages(request({ 'accept-language': 'fr' }), 'de');
    expect(result).toEqual(['de', 'fr', 'en']);
  });

  it('ignores an explicit lang the catalog does not support, falling through to the next signal', async () => {
    const result = await resolveLegalDocumentLanguages(request({ 'accept-language': 'pl' }), 'es');
    expect(result).toEqual(['pl', 'en']);
  });

  it("the signed-in caller's User.locale outranks Accept-Language", async () => {
    getSession.mockResolvedValue({ user: { id: 'user-1' } });
    findUnique.mockResolvedValue({ locale: 'it' });
    const result = await resolveLegalDocumentLanguages(request({ 'accept-language': 'de' }), undefined);
    expect(result).toEqual(['it', 'de', 'en']);
    expect(findUnique).toHaveBeenCalledWith({ where: { id: 'user-1' }, select: { locale: true } });
  });

  it('an explicit ?lang= still outranks the account locale', async () => {
    getSession.mockResolvedValue({ user: { id: 'user-1' } });
    findUnique.mockResolvedValue({ locale: 'it' });
    const result = await resolveLegalDocumentLanguages(request(), 'pt');
    expect(result).toEqual(['pt', 'it', 'en']);
  });

  it('no session at all (anonymous visitor) never touches Prisma, and falls through to Accept-Language', async () => {
    const result = await resolveLegalDocumentLanguages(
      request({ 'accept-language': 'pl,fr;q=0.5' }),
      undefined,
    );
    expect(result).toEqual(['pl', 'fr', 'en']);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('a session with no User.locale set falls through to Accept-Language', async () => {
    getSession.mockResolvedValue({ user: { id: 'user-1' } });
    findUnique.mockResolvedValue({ locale: null });
    const result = await resolveLegalDocumentLanguages(request({ 'accept-language': 'de' }), undefined);
    expect(result).toEqual(['de', 'en']);
  });

  it('an unsupported stored User.locale is treated the same as unset', async () => {
    getSession.mockResolvedValue({ user: { id: 'user-1' } });
    findUnique.mockResolvedValue({ locale: 'es' });
    const result = await resolveLegalDocumentLanguages(request({ 'accept-language': 'de' }), undefined);
    expect(result).toEqual(['de', 'en']);
  });

  it('getSession throwing outright (malformed cookie) never breaks the request — falls through silently', async () => {
    getSession.mockRejectedValue(new Error('boom'));
    const result = await resolveLegalDocumentLanguages(request({ 'accept-language': 'fr' }), undefined);
    expect(result).toEqual(['fr', 'en']);
  });

  it('a Prisma lookup failing after a valid session is found also falls through silently', async () => {
    getSession.mockResolvedValue({ user: { id: 'user-1' } });
    findUnique.mockRejectedValue(new Error('db down'));
    const result = await resolveLegalDocumentLanguages(request({ 'accept-language': 'fr' }), undefined);
    expect(result).toEqual(['fr', 'en']);
  });

  it('reads the first value of an Accept-Language header sent as an array', async () => {
    const result = await resolveLegalDocumentLanguages(
      request({ 'accept-language': ['pl', 'fr'] }),
      undefined,
    );
    expect(result).toEqual(['pl', 'en']);
  });
});
