import { DocumentEmailTemplate } from './types';
import { RenderLanguage } from '../rendering/language/supported-languages';

/**
 * TODO_FEATURES.md rank 14 ("langue du document par destinataire") — `invoice.descriptor.ts` and
 * `quote.descriptor.ts` ship the EXACT SAME English `email` default, word for word (compare the two
 * files' own `email` blocks), so their translated variants are written ONCE here rather than twice —
 * kept in sync by construction, not by discipline. A future type with genuinely different wording
 * should NOT reuse this: write its own `emailTranslations` next to its own `email`, the same way its
 * English default already stands on its own.
 *
 * Same placeholder vocabulary as the English original (`actions/email-template.ts#buildEmailTemplateParts`
 * — `{typeLabel}`, `{displayNumber}`, `{companyName}`, `{totalGross}`, `{recipientName}`), left
 * untranslated: these are substitution KEYS the interpolation engine matches literally
 * (`PLACEHOLDER_PATTERN`), not prose — renaming one here would just turn it into an unknown
 * placeholder, warned and left verbatim, in every language but English.
 */
export function standardDocumentEmailTranslations(): Partial<Record<RenderLanguage, DocumentEmailTemplate>> {
  return {
    fr: {
      subject: '{typeLabel} {displayNumber} de {companyName}',
      body:
        'Bonjour {recipientName},\n\n' +
        'Veuillez trouver ci-joint {typeLabel} {displayNumber} de {companyName}, pour un montant total de ' +
        '{totalGross}.\n\n' +
        'Cordialement,\n{companyName}',
    },
    it: {
      subject: '{typeLabel} {displayNumber} da {companyName}',
      body:
        'Gentile {recipientName},\n\n' +
        'In allegato {typeLabel} {displayNumber} da {companyName}, per un totale di {totalGross}.\n\n' +
        'Cordiali saluti,\n{companyName}',
    },
    pl: {
      subject: '{typeLabel} {displayNumber} od {companyName}',
      body:
        'Szanowni Państwo {recipientName},\n\n' +
        'W załączeniu {typeLabel} {displayNumber} od {companyName}, na łączną kwotę {totalGross}.\n\n' +
        'Z poważaniem,\n{companyName}',
    },
    de: {
      subject: '{typeLabel} {displayNumber} von {companyName}',
      body:
        'Sehr geehrte(r) {recipientName},\n\n' +
        'anbei erhalten Sie {typeLabel} {displayNumber} von {companyName} über einen Gesamtbetrag von ' +
        '{totalGross}.\n\n' +
        'Mit freundlichen Grüßen,\n{companyName}',
    },
    pt: {
      subject: '{typeLabel} {displayNumber} de {companyName}',
      body:
        'Caro(a) {recipientName},\n\n' +
        'Segue em anexo {typeLabel} {displayNumber} de {companyName}, no valor total de {totalGross}.\n\n' +
        'Com os melhores cumprimentos,\n{companyName}',
    },
  };
}
