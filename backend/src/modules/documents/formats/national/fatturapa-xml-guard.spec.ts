/**
 * Unit coverage for `fatturapa-xml-guard.ts`, isolated from the full FatturaPA builder —
 * `fatturapa-provider.spec.ts` carries the end-to-end proof (real vendored XSD + a second,
 * independent XML engine parsing the built document back). Here: the escaping rules themselves,
 * and that the tree-walk genuinely covers a field it has never seen before — the "one boundary,
 * not scattered calls" claim `fatturapa-provider.ts`'s call site makes.
 */
import { create } from 'xmlbuilder2';

import { escapeXmlText, escapeXmlTree } from './fatturapa-xml-guard';

describe('escapeXmlText', () => {
  it('leaves ordinary text byte-identical — the guard costs nothing on the normal path', () => {
    const ordinary = 'Consulenza tecnica - manutenzione ordinaria, sopralluogo del 12/03/2026 (è già pagato)';
    expect(escapeXmlText(ordinary)).toBe(ordinary);
  });

  it('escapes all five predefined entities, & first so its own entities are not re-escaped', () => {
    // If `&` were escaped AFTER `<`/`>`/etc., the `&` those replacements introduce would get
    // escaped AGAIN (`&lt;` → `&amp;lt;`). Asserting the exact output catches that class of bug.
    expect(escapeXmlText(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&apos;');
  });

  it('neutralises the comment/CDATA delimiter sequences the advisory (GHSA-gh4j-gqv2-49f6) concerns', () => {
    const withDelimiters = 'rif. <!-- v2 --> nota "finale" A&B ]]> validità 2024 --> 2025';
    const escaped = escapeXmlText(withDelimiters);
    expect(escaped).not.toContain('-->');
    expect(escaped).not.toContain('<!--');
    expect(escaped).not.toContain(']]>');
    expect(escaped).not.toContain('<');
    expect(escaped).not.toContain('>');
  });

  it('the escaped text still decodes back to the ORIGINAL, readable string once embedded in real XML', () => {
    // Independent proof, using a SECOND XML engine (`xmlbuilder2` — the library every other format
    // provider in this codebase already depends on) that never saw `escapeXmlText`'s own code: it
    // parses the escaped text as XML and DOM `textContent` decodes the entities back.
    const original = 'Support 2024 --> 2025';
    const xml = `<root><Descrizione>${escapeXmlText(original)}</Descrizione></root>`;
    // `.node` is typed as the generic DOM `Node` by xmlbuilder2; it is actually a `Document` here
    // (an `XMLDocumentImpl`), which is what carries `getElementsByTagName`.
    const dom = create(xml).node as unknown as Document;
    expect(dom.getElementsByTagName('Descrizione')[0].textContent).toBe(original);
  });
});

describe('escapeXmlTree', () => {
  it('walks nested objects and arrays, escaping every string leaf regardless of key name', () => {
    // Deliberately a key `escapeXmlTree` has never seen before — nothing in the function's own code
    // mentions "SomeFutureField". Passing proves coverage comes from the SHAPE of the tree, not a
    // per-field allowlist, which is the whole point of running the guard once over the object
    // instead of wrapping each field in `fatturapa-provider.ts` by hand.
    const tree = {
      Descrizione: 'a --> b',
      Nested: { SomeFutureField: 'c ]]> d', Lines: [{ Text: 'e & f' }, { Text: 'plain' }] },
    };
    const result = escapeXmlTree(tree);
    expect(result).toEqual({
      Descrizione: 'a --&gt; b',
      Nested: { SomeFutureField: 'c ]]&gt; d', Lines: [{ Text: 'e &amp; f' }, { Text: 'plain' }] },
    });
  });

  it('passes non-string leaves through untouched (numbers, booleans, null, undefined, Date)', () => {
    const when = new Date('2026-09-15T00:00:00.000Z');
    const tree = { n: 42, b: true, nul: null, und: undefined, when };
    const result = escapeXmlTree(tree);
    expect(result).toEqual({ n: 42, b: true, nul: null, und: undefined, when });
    expect(result.when).toBeInstanceOf(Date);
  });

  it('does not mutate the object it is given', () => {
    const tree = { Descrizione: 'a --> b' };
    escapeXmlTree(tree);
    expect(tree.Descrizione).toBe('a --> b');
  });
});
