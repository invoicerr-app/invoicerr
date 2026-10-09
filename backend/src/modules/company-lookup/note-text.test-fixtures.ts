import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CountryLookupCapability } from './types';

const EN_TRANSLATION = JSON.parse(
  readFileSync(join(__dirname, '../../../../frontend/src/locales/en/translation.json'), 'utf-8'),
);

/** The English text the frontend shows for one i18n key, or undefined when the key has none. */
export function englishText(key: string): string | undefined {
  const text = key.split('.').reduce((node, part) => node?.[part], EN_TRANSLATION);
  return typeof text === 'string' ? text : undefined;
}

/** The note as the English UI renders it. */
export function noteText(capability: CountryLookupCapability): string | undefined {
  const parts = capability.noteKeys.map((key) => {
    const text = englishText(key);
    if (text === undefined) throw new Error(`Missing English translation for ${key}`);
    return text;
  });
  return parts.join(' ') || undefined;
}
