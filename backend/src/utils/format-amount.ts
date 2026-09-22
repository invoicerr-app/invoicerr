import { resolveCountryCode } from '@/utils/watermark';

const FALLBACK_LOCALE = 'en-US';

function resolveAmountLocale(country?: string | null): string {
  if (!country) return FALLBACK_LOCALE;
  const code = resolveCountryCode(country);
  if (!code) return FALLBACK_LOCALE;
  try {
    return new Intl.Locale(`und-${code}`).maximize().toString();
  } catch {
    return FALLBACK_LOCALE;
  }
}

export function formatAmount(value: number, country?: string | null): string {
  return value.toLocaleString(resolveAmountLocale(country), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
