import { logger } from '@/logger/logger.service';

import { __resetDefaultLocaleForTests, resolveDefaultLocale } from './default-locale';

jest.mock('@/logger/logger.service', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

describe('resolveDefaultLocale', () => {
  const ORIGINAL_ENV = process.env.DEFAULT_LOCALE;

  beforeEach(() => {
    __resetDefaultLocaleForTests();
    (logger.warn as jest.Mock).mockClear();
  });

  afterAll(() => {
    process.env.DEFAULT_LOCALE = ORIGINAL_ENV;
    __resetDefaultLocaleForTests();
  });

  it('is undefined when unset — never crashes, never guesses', () => {
    delete process.env.DEFAULT_LOCALE;
    expect(resolveDefaultLocale()).toBeUndefined();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('is undefined for a blank/whitespace-only value, same as unset', () => {
    process.env.DEFAULT_LOCALE = '   ';
    expect(resolveDefaultLocale()).toBeUndefined();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('resolves a supported language, case-insensitively and whitespace-tolerant', () => {
    process.env.DEFAULT_LOCALE = '  FR  ';
    expect(resolveDefaultLocale()).toBe('fr');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('is undefined for an unsupported value and logs exactly one loud warning', () => {
    process.env.DEFAULT_LOCALE = 'zz';
    expect(resolveDefaultLocale()).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [message, options] = (logger.warn as jest.Mock).mock.calls[0];
    expect(message).toContain('DEFAULT_LOCALE="zz"');
    expect(options).toMatchObject({ category: 'mail', companyId: null });
  });

  it('memoizes: only reads/validates process.env once until reset', () => {
    process.env.DEFAULT_LOCALE = 'zz';
    expect(resolveDefaultLocale()).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledTimes(1);

    // Changing the env WITHOUT resetting must not be observed — the whole point of memoizing.
    process.env.DEFAULT_LOCALE = 'fr';
    expect(resolveDefaultLocale()).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledTimes(1);

    __resetDefaultLocaleForTests();
    expect(resolveDefaultLocale()).toBe('fr');
  });
});
