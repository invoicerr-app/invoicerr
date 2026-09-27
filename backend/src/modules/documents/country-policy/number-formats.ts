/**
 * Issue #496 - the per-(country, document type) NUMBER FORMAT, and the constraints it must satisfy.
 * Pure: no Prisma, no company lookup. `numbering/company-number-format.ts` is the one caller that
 * reads a company and composes this with its running series.
 *
 * Two questions live here, and they are deliberately separate:
 *  - "does this PATTERN always produce a lawful number?" (`patternViolations`): checked at LOAD time
 *    for every shipped format (a catalog that ships a format its own constraints refuse never boots),
 *    and at request time for a company's running series, against a worst case.
 *  - "is this NUMBER lawful?" (`numberViolations`): checked on the real, just-rendered number inside
 *    the numbering transaction (`numbering/sequence.ts`), so a number that would break a rule is never
 *    committed - the transaction rolls back and no number is spent.
 *
 * The worst case a pattern is judged against: the sequence at WORST_CASE_SEQUENCE_NUMBER (six
 * digits, a million documents of one type for one company) on the widest calendar date the tokens
 * can render. A company that outgrows six digits is still protected by the per-number check.
 */
import { assertValidNumberPattern, formatDocumentNumber } from '../numbering/format-number';
import {
  assertValidPolicyProvenance,
  CountryDocumentPolicyFile,
  CountryNumberFormats,
  DocumentNumberFormatFact,
  InvalidPolicyProvenanceError,
  NumberFormatConstraintFact,
} from './schema';

export const WORST_CASE_SEQUENCE_NUMBER = 999_999;
/** 31 December: the widest `{month}`/`{day}` render (two digits each without padding). */
const WORST_CASE_DATE = new Date(2099, 11, 31);

/** Every way ONE number can break ONE constraint - named, so a refusal can say which rule and why. */
export interface NumberFormatViolation {
  constraintId: string;
  message: string;
}

/** Checks one already-rendered number against every constraint given. Empty means lawful. */
export function numberViolations(
  displayNumber: string,
  constraints: NumberFormatConstraintFact[],
): NumberFormatViolation[] {
  const violations: NumberFormatViolation[] = [];
  for (const c of constraints) {
    if (c.maxLength !== undefined && displayNumber.length > c.maxLength) {
      violations.push({
        constraintId: c.id,
        message: `"${displayNumber}" is ${displayNumber.length} characters, the limit is ${c.maxLength}`,
      });
    }
    if (c.allowedCharacters !== undefined) {
      const bad = [...displayNumber].filter((ch) => !new RegExp(`^[${c.allowedCharacters}]$`).test(ch));
      if (bad.length > 0) {
        violations.push({
          constraintId: c.id,
          message: `"${displayNumber}" contains characters outside [${c.allowedCharacters}]: ${[
            ...new Set(bad),
          ]
            .map((ch) => JSON.stringify(ch))
            .join(', ')}`,
        });
      }
    }
    if (c.requiresDigit && !/[0-9]/.test(displayNumber)) {
      violations.push({ constraintId: c.id, message: `"${displayNumber}" contains no digit` });
    }
    if (c.forbidsEdgeOrDoubleSpaces && (/^ | $/.test(displayNumber) || / {2}/.test(displayNumber))) {
      violations.push({
        constraintId: c.id,
        message: `"${displayNumber}" starts or ends with a space, or contains two spaces in a row`,
      });
    }
    if (c.mustMatch !== undefined && !new RegExp(c.mustMatch).test(displayNumber)) {
      violations.push({
        constraintId: c.id,
        message: `"${displayNumber}" does not match the required shape ${c.mustMatch}`,
      });
    }
  }
  return violations;
}

/**
 * Whether a PATTERN can only ever produce lawful numbers (up to the worst case in this file's
 * header). A pattern the renderer itself refuses (no `{number}` token, an unknown token) is reported
 * as a violation too, never thrown: a company's running series is judged with this at request time,
 * and a broken legacy pattern must lead to the country format, not to a 500.
 */
export function patternViolations(
  pattern: string,
  constraints: NumberFormatConstraintFact[],
): NumberFormatViolation[] {
  let rendered: string;
  try {
    rendered = formatDocumentNumber(pattern, { number: WORST_CASE_SEQUENCE_NUMBER, date: WORST_CASE_DATE });
  } catch (error) {
    return [{ constraintId: 'pattern', message: (error as Error).message }];
  }
  return numberViolations(rendered, constraints);
}

/** The constraints binding one format, in declaration order. */
export function constraintsFor(
  formats: CountryNumberFormats,
  format: DocumentNumberFormatFact,
): NumberFormatConstraintFact[] {
  return format.constrainedBy.map((id) => {
    const found = formats.constraints.find((c) => c.id === id);
    if (!found) throw new Error(`number format for "${format.typeId}" names unknown constraint "${id}"`);
    return found;
  });
}

/**
 * The gate every shipped `numberFormats` block passes - at load (`data/all.ts`) and again at seed
 * (`seed.ts`), the same two points every other fact in this catalog is checked at. Refuses:
 * a constraint or running-series policy with no valid provenance; a duplicate constraint id or a
 * duplicate format for one type; a format naming a constraint that does not exist, or one that does
 * not apply to its type; a constraint binding a type the format does not list (a rule quietly left
 * out of a format is exactly the silent gap this catalog exists to prevent); a format with no
 * constraint and no `unconstrained` statement; and, the point of it all, a format whose own
 * worst-case number its own constraints refuse.
 */
export function assertValidNumberFormats(file: CountryDocumentPolicyFile, context: string): void {
  const formats = file.numberFormats;
  if (!formats) return;
  const where = `${context}: numberFormats`;

  const ids = new Set<string>();
  for (const c of formats.constraints) {
    if (!c.id?.trim()) throw new Error(`${where} has a constraint with no id`);
    if (ids.has(c.id)) throw new Error(`${where} declares constraint "${c.id}" twice`);
    ids.add(c.id);
    if (!Array.isArray(c.appliesTo) || c.appliesTo.length === 0) {
      throw new Error(`${where}: constraint "${c.id}" applies to no document type`);
    }
    if (!c.summary?.trim()) throw new Error(`${where}: constraint "${c.id}" has no summary`);
    assertValidPolicyProvenance(c.provenance, `${where}: constraint "${c.id}"`, 'a number-format constraint');
  }

  if (!formats.runningSeries?.summary?.trim() || !formats.runningSeries.onViolation?.trim()) {
    throw new InvalidPolicyProvenanceError(
      `${where}: runningSeries must say what happens to an existing series, and what happens when it ` +
        'breaks a constraint.',
    );
  }
  assertValidPolicyProvenance(
    formats.runningSeries.provenance,
    `${where}: runningSeries`,
    'a running-series policy',
  );

  const typeIds = new Set<string>();
  for (const f of formats.formats) {
    if (typeIds.has(f.typeId)) throw new Error(`${where} declares two formats for "${f.typeId}"`);
    typeIds.add(f.typeId);
    if (!f.rationale?.trim()) throw new Error(`${where}: format "${f.typeId}" has no rationale`);
    assertValidNumberPattern(f.pattern, `${where}: format "${f.typeId}"`);

    const bound = constraintsFor(formats, f);
    for (const c of bound) {
      if (!c.appliesTo.includes(f.typeId)) {
        throw new Error(
          `${where}: format "${f.typeId}" names constraint "${c.id}", which does not apply to it`,
        );
      }
    }
    for (const c of formats.constraints) {
      if (c.appliesTo.includes(f.typeId) && !f.constrainedBy.includes(c.id)) {
        throw new Error(
          `${where}: constraint "${c.id}" applies to "${f.typeId}" but that type's format does not list it`,
        );
      }
    }
    if (bound.length === 0 && !f.unconstrained?.trim()) {
      throw new Error(
        `${where}: format "${f.typeId}" has no constraint and no "unconstrained" statement - say what was ` +
          'checked to conclude nothing constrains it.',
      );
    }

    const violations = patternViolations(f.pattern, bound);
    if (violations.length > 0) {
      throw new Error(
        `${where}: the shipped format "${f.pattern}" for "${f.typeId}" breaks its own constraints at ` +
          `number ${WORST_CASE_SEQUENCE_NUMBER}: ${violations.map((v) => `${v.constraintId} (${v.message})`).join('; ')}`,
      );
    }
  }

  for (const c of formats.constraints) {
    for (const typeId of c.appliesTo) {
      if (!typeIds.has(typeId)) {
        throw new Error(`${where}: constraint "${c.id}" applies to "${typeId}", which has no format`);
      }
    }
  }
}
