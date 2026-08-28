/**
 * P2-V02 — the attachment predicate: what makes a national obligation apply to THIS operation.
 *
 * Named "attachment", not "establishment", because the French text is threefold and the shorter
 * name silenced two thirds of it. CGI art. 289 bis I (Légifrance, consulted 2026-08-28): the
 * e-invoicing obligation applies "lorsque l'émetteur de la facture et son destinataire sont des
 * assujettis qui sont **établis ou ont leur domicile ou leur résidence habituelle en France**".
 * Three alternative criteria — a natural person can be attached by domicile or habitual residence
 * without a fixed establishment.
 *
 * Discriminated union rather than a boolean flag, because the attachment rule differs across the
 * pivots and encoding the arbitration in code would put country names back into business logic —
 * which the architecture forbids. Here it stays data, and `data-integrity.spec.ts` already knows
 * how to check data.
 *
 * This module is PURE. No profile, no registry, no I/O — it answers "does this rule catch this
 * operation", nothing more. Wiring it into `resolve()` is a later task; P2-V02 exists to find out
 * whether the shape survives the six pivots BEFORE anything depends on it.
 */
import type { ISO3166Alpha2 } from '../types';

/**
 * How a party is attached to a country for THIS operation.
 *
 * `null` means unresolved, and it is not the same as "not attached". An operation whose attachment
 * is unknown must block rather than fall back — the silent `?? 'FR'` in invoices.helpers.ts is
 * exactly the defect this type exists to make impossible to express.
 */
export type Attachment = ISO3166Alpha2 | null;

export interface OperationParties {
  /** Where the SUPPLIER is established / domiciled / habitually resident for this operation. */
  supplier: Attachment;
  /** Where the BUYER is. */
  buyer: Attachment;
}

/**
 * What the operation IS, beyond who the parties are. Some exclusions key on the nature of the
 * supply rather than on attachment — CGI art. 289 bis V excludes intra-EU exempt supplies whatever
 * the parties' attachment.
 */
export interface OperationNature {
  /** Exempt intra-Community supply — CGI art. 262 ter I 1°. */
  intraCommunitySupply?: boolean;
  /** Exempt export — CGI art. 262 I. */
  export?: boolean;
}

export type AttachmentPredicate =
  /** Both parties attached to the country. FR art. 289 bis I; DE §14 UStG. */
  | { kind: 'BOTH_ATTACHED_TO'; country: ISO3166Alpha2 }
  /** The supplier suffices. PL — KSeF binds the established seller. */
  | { kind: 'SUPPLIER_ATTACHED_TO'; country: ISO3166Alpha2 }
  /** The buyer drives it. ES B2B mandate — pulled by the obligated recipient. */
  | { kind: 'BUYER_ATTACHED_TO'; country: ISO3166Alpha2 }
  /** Either party suffices. IT SdI. */
  | { kind: 'EITHER_ATTACHED_TO'; country: ISO3166Alpha2 }
  /** The complement of BOTH — this is what carries e-reporting. */
  | { kind: 'NOT_BOTH_ATTACHED_TO'; country: ISO3166Alpha2 }
  /**
   * An exclusion keyed on the NATURE of the supply, not on attachment.
   * CGI art. 289 bis V: the e-invoicing obligation does not apply to operations under art. 262
   * ter I 1°, whatever the parties' attachment. P2-V01 established that this is a SECOND,
   * independent route — a predicate with only BOTH_ATTACHED_TO would give the right answer for
   * FR→IT by accident.
   */
  | { kind: 'NOT_OF_NATURE'; nature: keyof OperationNature }
  | { kind: 'ALWAYS' };

/** Every branch must be handled; a new kind becomes a compile error rather than a silent `false`. */
function exhausted(x: never): never {
  throw new Error(`unhandled attachment predicate: ${JSON.stringify(x)}`);
}

/**
 * Does this predicate catch this operation?
 *
 * Returns `null` when it cannot be decided — an unresolved attachment on a party the predicate
 * needs. The caller must treat `null` as "block and say what is missing", never as `false`.
 */
export function evaluate(
  predicate: AttachmentPredicate,
  parties: OperationParties,
  nature: OperationNature = {},
): boolean | null {
  switch (predicate.kind) {
    case 'ALWAYS':
      return true;

    case 'BOTH_ATTACHED_TO':
      if (parties.supplier === null || parties.buyer === null) return null;
      return parties.supplier === predicate.country && parties.buyer === predicate.country;

    case 'NOT_BOTH_ATTACHED_TO': {
      if (parties.supplier === null || parties.buyer === null) return null;
      const both = parties.supplier === predicate.country && parties.buyer === predicate.country;
      return !both;
    }

    case 'SUPPLIER_ATTACHED_TO':
      if (parties.supplier === null) return null;
      return parties.supplier === predicate.country;

    case 'BUYER_ATTACHED_TO':
      if (parties.buyer === null) return null;
      return parties.buyer === predicate.country;

    case 'EITHER_ATTACHED_TO': {
      const s = parties.supplier === predicate.country;
      const b = parties.buyer === predicate.country;
      if (s || b) return true;
      // Neither matches — but an unresolved party could have. Undecidable, not false.
      if (parties.supplier === null || parties.buyer === null) return null;
      return false;
    }

    case 'NOT_OF_NATURE':
      return nature[predicate.nature] !== true;

    default:
      return exhausted(predicate);
  }
}

/**
 * All predicates of a rule must hold. `null` (undecidable) dominates `false`: if any predicate is
 * undecidable the answer is undecidable, because resolving it could flip the result.
 */
export function evaluateAll(
  predicates: AttachmentPredicate[],
  parties: OperationParties,
  nature: OperationNature = {},
): boolean | null {
  let undecidable = false;
  for (const p of predicates) {
    const verdict = evaluate(p, parties, nature);
    if (verdict === null) undecidable = true;
    else if (verdict === false) return false;
  }
  return undecidable ? null : true;
}
