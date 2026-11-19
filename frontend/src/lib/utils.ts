import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// The theme's named shadows and radii, so an override of one actually replaces it.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      shadow: ["sheet", "pop", "press", "press-destructive", "control", "inset"],
      radius: ["control", "panel"],
    },
  },
})

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
