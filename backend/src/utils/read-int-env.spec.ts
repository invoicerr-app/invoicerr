import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readIntEnv } from './read-int-env';

describe('readIntEnv', () => {
  const NAME = 'READ_INT_ENV_TEST_VALUE';
  const ORIGINAL = process.env[NAME];

  beforeEach(() => {
    delete process.env[NAME];
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (ORIGINAL === undefined) delete process.env[NAME];
    else process.env[NAME] = ORIGINAL;
  });

  it('falls back silently when the variable is unset', () => {
    expect(readIntEnv(NAME, 500)).toBe(500);
    expect(Logger.prototype.warn).not.toHaveBeenCalled();
  });

  it('reads a positive integer, surrounding whitespace included', () => {
    process.env[NAME] = ' 250 ';
    expect(readIntEnv(NAME, 500)).toBe(250);
    expect(Logger.prototype.warn).not.toHaveBeenCalled();
  });

  it.each(['', '  ', '0', '-5', '12.5', '1h', 'abc', 'NaN', 'Infinity', '1e3'])(
    'falls back and warns for %j',
    (value) => {
      process.env[NAME] = value;
      expect(readIntEnv(NAME, 500)).toBe(500);
      expect(Logger.prototype.warn).toHaveBeenCalledOnce();
    },
  );
});
