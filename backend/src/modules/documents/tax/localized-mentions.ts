/** The statutory wording a country prescribes for an invoice mention, per tax situation. A situation
 *  with no entry for a country falls back to the engine's generic mention. */
export const LOCALIZABLE_SITUATIONS = ['reverseCharge', 'intraComm', 'exportGoods', 'franchise'] as const;

export type LocalizableSituation = (typeof LOCALIZABLE_SITUATIONS)[number];

export interface LocalizedMentionFact {
  code: string;
  text: string;
  /** The statute reference and the quoted wording this entry is read from. */
  source: string;
}

export interface CountryLocalizedMentionsFile {
  countryCode: string;
  situations: Partial<Record<LocalizableSituation, LocalizedMentionFact>>;
}

export class InvalidLocalizedMentionError extends Error {}

export function assertValidLocalizedMentions(file: CountryLocalizedMentionsFile, context: string): void {
  for (const [situation, fact] of Object.entries(file.situations ?? {})) {
    if (!(LOCALIZABLE_SITUATIONS as readonly string[]).includes(situation)) {
      throw new InvalidLocalizedMentionError(
        `${context}: unknown situation "${situation}", expected one of ${LOCALIZABLE_SITUATIONS.join(', ')}.`,
      );
    }
    for (const field of ['code', 'text', 'source'] as const) {
      if (typeof fact?.[field] !== 'string' || !fact[field].trim()) {
        throw new InvalidLocalizedMentionError(`${context}: "${situation}" needs a non-empty "${field}".`);
      }
    }
  }
}
