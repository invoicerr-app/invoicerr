/**
 * CARRIED OVER almost verbatim from `compliance/engine/classification.ts` (git tag
 * `avant-refonte-documents`) — only the import paths change (types come from `./types`, specific to
 * this module). The composition cascade is carried over AS-IS: see `tax-engine.ts`'s own header for
 * what changed around it.
 *
 * Issue #603 (PR A): `EU_MEMBERS`/`GCC_VAT` used to be this file's OWN copy of a list that also lived,
 * independently, in `formats/semantic/build-semantic-invoice.ts` (`VAT_PREFIX_TO_PEPPOL_EAS`),
 * `formats/national/fatturapa-provider.ts` (`EU_CC`) and `ocr-service/local-client.ts`
 * (`EU_VAT_PREFIXES`) - four copies that could, and in one documented case did, disagree (see this
 * PR's own report). `taxUnionOf` now reads the shared `tax/tax-unions/` reference table instead -
 * same exported signature, same return values, proven byte-for-byte unchanged over every ISO country
 * code.
 */
import { ISO3166Alpha2, PartyRole, PartyTaxProfile, SupplyType } from './types';
import { defaultTaxUnionRegistry, TaxUnion } from './tax-unions/registry';

export type { TaxUnion };

export function taxUnionOf(country: ISO3166Alpha2): TaxUnion | null {
  return defaultTaxUnionRegistry.taxUnionOf(country);
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
