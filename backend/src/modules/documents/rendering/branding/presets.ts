import { BrandingFontKey } from './font-catalog';

export interface BrandingPreset {
  id: string;
  label: string;
  /** Hex `#rrggbb` — the exact shape `Company.brandingAccentColor` itself is validated against
   *  (`company/branding/branding.service.ts#assertValidHexColor`), so a preset's own value never
   *  needs a second validation pass when it is written straight through on selection. */
  accentColor: string;
  font: BrandingFontKey;
}

/**
 * Named combinations of the three brand fields (chantier B, 2026-09-15 product decision) — what the
 * settings screen's tile picker offers. A preset is only ever a STARTING point, never a live binding:
 * see `Company.brandingPreset`'s own schema.prisma comment for why picking one and then hand-
 * adjusting the color or font afterwards does not clear `brandingPreset` back to null. The catalog is
 * the single source of truth for BOTH the frontend tiles and `branding.service.ts#setBranding`'s own
 * "preset named, no explicit override" resolution — never duplicated on the frontend.
 */
export const BRANDING_PRESETS: readonly BrandingPreset[] = [
  { id: 'classic', label: 'Classic', accentColor: '#1d4ed8', font: 'inter' },
  { id: 'modern', label: 'Modern', accentColor: '#0f766e', font: 'dmSans' },
  { id: 'minimal', label: 'Minimal', accentColor: '#111827', font: 'ibmPlexSans' },
  { id: 'bold', label: 'Bold', accentColor: '#b91c1c', font: 'lora' },
];

export function brandingPresetById(id: string | null | undefined): BrandingPreset | undefined {
  return BRANDING_PRESETS.find((preset) => preset.id === id);
}
