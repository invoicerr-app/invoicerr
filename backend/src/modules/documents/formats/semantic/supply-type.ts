/**
 * Minimal reprise of the removed compliance engine's own `SupplyType` (`compliance/types.ts` at the
 * `avant-refonte-documents` reference) — only the two values `business-process.ts` consumes survive
 * here.
 *
 * NOW FED BY REAL DATA: the trunk `invoice.descriptor.ts` still has no "line nature" field — it is the
 * FR country OVERLAY (`country-fields/data/fr.json`) that adds a `supplyType` subfield (kind 'select',
 * values 'GOODS'/'SERVICES', OPTIONAL) to `lines`, exactly the two values of this type — never an `if`
 * inside `invoice.descriptor.ts` itself, which stays country-blind. See `country-fields/data/fr.json`'s
 * own header for the choice made (option a: a line-level subfield rather than a single document field)
 * and `formats/shared-build.ts#extractLines` for where the raw value (an arbitrary string typed on the
 * client side) is narrowed onto this strict type — any other value is treated as absent, never guessed.
 */
export type SupplyType = 'GOODS' | 'SERVICES';
