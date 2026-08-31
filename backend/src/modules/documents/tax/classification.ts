/**
 * REPRISE quasi verbatim de `compliance/engine/classification.ts` (git tag `avant-refonte-documents`)
 * — seuls les chemins d'import changent (les types viennent de `./types`, propres à ce module). Le
 * contenu (listes de pays, cascade de composition) est repris TEL QUEL : voir `tax-engine.ts`'s own
 * header pour ce qui a changé autour, et le rapport de cette tâche pour la liste exacte.
 */
import { ISO3166Alpha2, PartyRole, PartyTaxProfile, SupplyType } from './types';

/** EU VAT territory (member states). Used so cross-border tax composes from a table, not N² pairs. */
export const EU_MEMBERS = new Set<string>([
  'AT',
  'BE',
  'BG',
  'HR',
  'CY',
  'CZ',
  'DK',
  'EE',
  'FI',
  'FR',
  'DE',
  'GR',
  'HU',
  'IE',
  'IT',
  'LV',
  'LT',
  'LU',
  'MT',
  'NL',
  'PL',
  'PT',
  'RO',
  'SK',
  'SI',
  'ES',
  'SE',
]);

/** GCC VAT-implementing states. */
export const GCC_VAT = new Set<string>(['SA', 'AE', 'BH', 'OM', 'KW', 'QA']);

export type TaxUnion = 'EU' | 'GCC';

export function taxUnionOf(country: ISO3166Alpha2): TaxUnion | null {
  const c = (country ?? '').toUpperCase();
  if (EU_MEMBERS.has(c)) return 'EU';
  if (GCC_VAT.has(c)) return 'GCC';
  return null;
}

/** Pluggable VAT-number validation (VIES, registry lookups, …). */
export interface VatValidator {
  hasValidVat(party: PartyTaxProfile): boolean;
}

/**
 * Default validator. Conservative by design: a party is only treated as VAT-valid when its VAT
 * identifier is explicitly validated (`validated === true`). When unsure we do NOT grant
 * reverse-charge / zero-rating — we charge VAT — so the safe default never under-charges tax.
 */
export class TrustFlagVatValidator implements VatValidator {
  hasValidVat(party: PartyTaxProfile): boolean {
    const vat = party.identifiers.find((i) => i.scheme.toUpperCase() === 'VAT');
    return !!vat && vat.validated === true;
  }
}

export interface ClassificationSelector {
  roles?: PartyRole[];
  supply?: SupplyType[];
}

export function selectorMatches(
  sel: ClassificationSelector | undefined,
  buyerRole: PartyRole,
  supplyTypes: SupplyType[],
): boolean {
  if (!sel) return true;
  if (sel.roles && !sel.roles.includes(buyerRole)) return false;
  if (sel.supply && !supplyTypes.some((s) => sel.supply!.includes(s))) return false;
  return true;
}
