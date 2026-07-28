import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { resolveCountryCode } from "@/lib/watermark"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Returns data-cy attribute only in test mode (when VITE_E2E_TESTING is set)
 * This keeps data-cy attributes out of production builds
 */
export function dataCy(value: string): Record<string, string> {
  if (import.meta.env.VITE_E2E_TESTING === "true") {
    return { "data-cy": value }
  }
  return {}
}

const FALLBACK_LOCALE = "en-US"

function resolveAmountLocale(country?: string | null): string {
  if (!country) return FALLBACK_LOCALE
  const code = resolveCountryCode(country)
  if (!code) return FALLBACK_LOCALE
  try {
    return new Intl.Locale(`und-${code}`).maximize().toString()
  } catch {
    return FALLBACK_LOCALE
  }
}

/** Formats a monetary amount with a thousands separator adapted to the company's country, keeping 2 decimal places. */
export function formatAmount(value: number, country?: string | null): string {
  return value.toLocaleString(resolveAmountLocale(country), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/** Turns free text into a safe, lowercase, hyphenated filename segment (accents stripped). */
export function slugifyFilename(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "") // strip combining accent marks left behind by NFD normalization
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}
