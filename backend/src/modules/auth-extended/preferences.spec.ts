import { vi, type Mock } from 'vitest';

import { BadRequestException } from '@nestjs/common';

// Same shape `account-lifecycle.spec.ts` already uses for a module that imports the shared `prisma`
// singleton directly (never via Nest DI).
vi.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: { user: { update: vi.fn() } },
}));

import prisma from '@/prisma/prisma.service';
import { parseAccountLocaleInput, setUserLocale } from './preferences';

const mockUserUpdate = (prisma as unknown as { user: { update: Mock } }).user.update;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('parseAccountLocaleInput', () => {
  it('normalizes (trims + lowercases) a supported locale', () => {
    expect(parseAccountLocaleInput({ locale: '  FR  ' })).toBe('fr');
    expect(parseAccountLocaleInput({ locale: 'pt' })).toBe('pt');
  });

  it('passes null through unchanged — clearing the preference is a valid write', () => {
    expect(parseAccountLocaleInput({ locale: null })).toBeNull();
  });

  it('rejects (400) an unsupported language, unlike sign-up which would silently drop it', () => {
    expect(() => parseAccountLocaleInput({ locale: 'es' })).toThrow(BadRequestException);
    expect(() => parseAccountLocaleInput({ locale: 'ar' })).toThrow(BadRequestException);
  });

  it('names every supported language in the 400 message, so a caller can self-correct', () => {
    try {
      parseAccountLocaleInput({ locale: 'es' });
      throw new Error('expected parseAccountLocaleInput to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const message = (error as BadRequestException).message;
      for (const code of ['en', 'fr', 'it', 'pl', 'de', 'pt']) {
        expect(message).toContain(code);
      }
    }
  });

  it('rejects (400) a non-string value', () => {
    expect(() => parseAccountLocaleInput({ locale: 42 })).toThrow(BadRequestException);
    expect(() => parseAccountLocaleInput({ locale: ['fr'] })).toThrow(BadRequestException);
  });

  it('rejects (400) a missing body or a body with no `locale` key at all — never treated as a silent no-op', () => {
    expect(() => parseAccountLocaleInput(undefined)).toThrow(BadRequestException);
    expect(() => parseAccountLocaleInput({})).toThrow(BadRequestException);
  });
});

describe('setUserLocale', () => {
  it('writes the normalized value and returns what was actually persisted', async () => {
    mockUserUpdate.mockResolvedValue({ locale: 'fr' });

    const result = await setUserLocale('user-1', 'fr');

    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { locale: 'fr' },
      select: { locale: true },
    });
    expect(result).toBe('fr');
  });

  it('can clear the preference back to null', async () => {
    mockUserUpdate.mockResolvedValue({ locale: null });

    const result = await setUserLocale('user-1', null);

    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { locale: null },
      select: { locale: true },
    });
    expect(result).toBeNull();
  });
});
