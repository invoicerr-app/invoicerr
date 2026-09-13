/**
 * Neutralises XML metacharacters in every string reaching `@digitalia/fatturapa`'s `fpa2xml`
 * builder, at ONE point — the whole object literal, right before it is handed to the builder —
 * rather than at each field inside `fatturapa-provider.ts`.
 *
 * ## Why this is needed
 * `@digitalia/fatturapa@1.3.1` pins `fast-xml-parser@3.21.1` (`npm ls fast-xml-parser` shows
 * exactly that one path; no version bump of ours removes it — `npm audit` reports it
 * `fixAvailable: false` for that structural reason). `npm audit`'s advisory for it is "XMLBuilder:
 * XML Comment and CDATA Injection via Unescaped Delimiters" (GHSA-gh4j-gqv2-49f6). Verified
 * directly against the vendored copy (`node_modules/fast-xml-parser/src/json2xml.js`): its
 * `tagValueProcessor`/`attrValueProcessor` default to the identity function, and
 * `@digitalia/fatturapa`'s own `parserOptions` (`node_modules/@digitalia/fatturapa/src/common/
 * index.ts`) never overrides either — so v3's builder escapes NOTHING in a string it is given.
 * Concretely: `new j2xParser(parserOptions).parse({ root: { child: 'a --> b <x/> & "q"' } })`
 * emits `<root><child>a --> b <x/> & "q"</child></root>` verbatim. A free-text field (an invoice
 * line's description, a party's name or address, …) containing `-->` or `]]>` can therefore close
 * a surrounding comment/CDATA early, and a bare `<tag>` is written straight into the document as a
 * literal, well-formed-breaking element. Realistic harm: an invalid or altered FatturaPA document
 * reaching SdI (the Italian tax authority) — this is a document-integrity defect, not RCE.
 *
 * ## Why the fix walks the whole tree instead of wrapping each field
 * A per-call-site `escapeXmlText(x)` wrapper is exactly the kind of guard a field added to
 * `fatturapa-provider.ts` tomorrow can silently bypass — nothing forces a future author to
 * remember it. Walking the object graph once, here, right before serialisation, means every
 * current field (`Descrizione`, both parties' `Denominazione`, `Indirizzo`/`Comune`/`CAP`,
 * `Contatti`, …) AND any field added later are covered by construction, without the provider
 * needing to know which of its own fields are "free text". The one way a future field could still
 * slip past this guard is if a provider stops routing its whole payload through
 * `escapeXmlTree` before calling `fpa2xml` — i.e. the boundary is this one call, not a type system
 * guarantee; see `fatturapa-provider.ts`'s own call site.
 *
 * ## Why this preserves ordinary text
 * Only the five characters XML always treats specially are rewritten, to their standard
 * predefined entities: `&` → `&amp;`, `<` → `&lt;`, `>` → `&gt;`, `"` → `&quot;`, `'` → `&apos;`
 * (order matters — `&` first, or escaping `<`/`>`/etc. would introduce new `&` characters that
 * then get double-escaped). Every conformant XML parser decodes these back to the original
 * character when reading the document, so a human (or SdI) reading the delivered invoice sees the
 * exact original text — e.g. a line reading `Support 2024 --> 2025` is stored as
 * `Support 2024 --&gt; 2025` and reads back as `Support 2024 --> 2025`. Text with none of these
 * five characters — the overwhelming majority of real invoice text — is untouched byte-for-byte.
 */

const XML_METACHARACTERS: [RegExp, string][] = [
  [/&/g, '&amp;'],
  [/</g, '&lt;'],
  [/>/g, '&gt;'],
  [/"/g, '&quot;'],
  [/'/g, '&apos;'],
];

/** Escapes the five XML predefined-entity characters in a single string. Exported for the test
 *  suite; `fatturapa-provider.ts` itself should go through `escapeXmlTree` below, never call this
 *  directly on individual fields — see this file's own header for why. */
export function escapeXmlText(value: string): string {
  return XML_METACHARACTERS.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), value);
}

/**
 * Recursively rewrites every string leaf of `value` with `escapeXmlText`, preserving the shape of
 * plain objects and arrays. Numbers, booleans, `Date`s, `null` and `undefined` pass through
 * unchanged — `fpa2xml` stringifies them itself and none of them can carry a delimiter sequence.
 */
export function escapeXmlTree<T>(value: T): T {
  if (typeof value === 'string') {
    return escapeXmlText(value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => escapeXmlTree(item)) as unknown as T;
  }
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      result[key] = escapeXmlTree(entry);
    }
    return result as T;
  }
  return value;
}
