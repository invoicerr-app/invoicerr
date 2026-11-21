import { Logger } from '@nestjs/common';

const logger = new Logger('readIntEnv');

/**
 * Reads a positive integer from the environment. `parseInt` alone reads `'1h'` as `1` and `''` as
 * `NaN`, which turns a sweep interval into a hot loop or a webhook backoff into no delay at all.
 */
export function readIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;

  const trimmed = raw.trim();
  const parsed = /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
  if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;

  logger.warn(`${name}="${raw}" is not a positive integer, using ${fallback} instead.`);
  return fallback;
}
