import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SERVER_MESSAGES_EN } from './messages.en';
import { formatServerMessage, serverMessage } from './server-message';

/** The frontend's English catalog, read from the sibling project: the same keys must carry the same
 *  text, or a warning says one thing on screen and another in the PDF. */
const FRONTEND_EN = JSON.parse(
  readFileSync(join(__dirname, '../../../../../frontend/src/locales/en/translation.json'), 'utf-8'),
) as Record<string, unknown>;

function lookup(tree: Record<string, unknown>, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => {
    if (node && typeof node === 'object' && part in (node as Record<string, unknown>)) {
      return (node as Record<string, unknown>)[part];
    }
    return undefined;
  }, tree);
}

describe('server message catalog', () => {
  it('has the exact same key and text in the frontend English catalog', () => {
    for (const [key, text] of Object.entries(SERVER_MESSAGES_EN)) {
      expect(lookup(FRONTEND_EN, key), key).toBe(text);
    }
  });

  it('contains no em dash: every message is repository prose', () => {
    for (const [key, text] of Object.entries(SERVER_MESSAGES_EN)) {
      expect(text.includes('—'), key).toBe(false);
    }
  });

  it('uses only the {{name}} placeholder syntax the frontend t() understands', () => {
    for (const [key, text] of Object.entries(SERVER_MESSAGES_EN)) {
      // Any single brace left over would render literally on screen: i18next only interpolates {{x}}.
      expect(/(^|[^{])\{[^{]/.test(text), key).toBe(false);
    }
  });
});

describe('formatServerMessage', () => {
  it('substitutes every param, including a repeated one', () => {
    expect(
      formatServerMessage(
        serverMessage('documents.messages.tax.ossStandardRate', { country: 'DE', rate: 19 }),
      ),
    ).toContain("DE's STANDARD VAT rate (19%)");
  });

  it('leaves an unfilled placeholder visible instead of blanking it', () => {
    expect(formatServerMessage(serverMessage('documents.messages.totals.vatRateMissing'))).toContain(
      '{{line}}',
    );
  });
});
