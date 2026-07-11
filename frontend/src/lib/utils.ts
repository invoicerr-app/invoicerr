import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

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

/** Turns free text into a safe, lowercase, hyphenated filename segment (accents stripped). */
export function slugifyFilename(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "") // strip combining accent marks left behind by NFD normalization
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}
