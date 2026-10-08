/**
 * fatturapa-provider.ts — same discipline as `fa3-provider.spec.ts`:
 * proves the REAL vendored `Schema_VFPR12.xsd` judges what this provider emits, that an amount
 * TRACES from the document's own data through `compute-totals.ts` to a specific XML field (never
 * recomputed here), and that the gate actually enforces something (a mandatory field removed makes
 * the SAME schema reject it) — plus the CodiceDestinatario/PECDestinatario routing REPRISED from
 * `fattura-pa.spec.ts` at the reference.
 */
import { create } from 'xmlbuilder2';

import { ALL_COUNTRY_IDENTIFIER_FILES } from '@/modules/documents/country-identifiers/data/all';

import { buildInvoiceDescriptor } from '../../descriptors/invoice.descriptor';
import { DocumentTypeDescriptor } from '../../descriptors/types';
import { DocumentFormatParty } from '../format-provider';
import { validateXsd } from '../vendored/validate-xsd';
import { fatturapaFormatProvider, mapNatura } from './fatturapa-provider';

const descriptor: DocumentTypeDescriptor = buildInvoiceDescriptor();

const SELLER: DocumentFormatParty = {
  name: 'Rossi SRL',
  address: 'Via Roma 10',
  city: 'Milano',
  postalCode: '20100',
  country: 'Italy',
  partyIdentifiers: [
    { scheme: 'VAT', value: 'IT12345678901' },
    { scheme: 'LEGAL_ID', value: 'MI1234567' },
  ],
};

const BUYER: DocumentFormatParty = {
  name: 'Bianchi SpA',
  address: 'Corso Italia 20',
  city: 'Roma',
  postalCode: '00100',
  country: 'Italy',
  partyIdentifiers: [{ scheme: 'VAT', value: 'IT98765432109' }],
};

/**
 * Hand-computed fixture:
 *  - Line 1: 1 × 1000.00 € @ 22% VAT, no discount → net 1000.00; VAT 220.00.
 *  - Line 2: 2 × 50.00 € @ 10% VAT, 20% discount → net AFTER discount 80.00 (100 × 0.80); VAT 8.00
 *    (10% of 80).
 *  - Document total: net 1080.00; VAT 228.00; gross 1308.00.
 */
const VALID_DATA = {
  client: 'client-1',
  issueDate: '2026-09-15',
  dueDate: '2026-10-15',
  currency: 'EUR',
  lines: [
    { description: 'Consulenza strategica', quantity: 1, unit: 'unit', unitPrice: 1000, vatRate: '22' },
    {
      description: 'Assistenza tecnica',
      quantity: 2,
      unit: 'ora',
      unitPrice: 50,
      vatRate: '10',
      discountPercent: 20,
    },
  ],
};

function extractTag(xml: string, tag: string): string | undefined {
  const m = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return m?.[1];
}

function flatten(xml: string): string {
  return xml.replace(/>\s+</g, '><');
}

function document(data: unknown, displayNumber = 'FT-2026-0001') {
  return { id: 'doc-1', data, displayNumber, status: 'sending' };
}

describe('fatturapa-provider — FatturaPA gated by the REAL vendored Schema_VFPR12.xsd', () => {
  it('declares itself correctly for the format registry / download-xml param', () => {
    expect(fatturapaFormatProvider.id).toBe('fatturapa');
    expect(fatturapaFormatProvider.mime).toBe('application/xml');
  });

  it('a VALID document: passes the real XSD, and computed amounts (discount applied) reach the right fields', async () => {
    const result = await fatturapaFormatProvider.build(descriptor, document(VALID_DATA), SELLER, BUYER);

    expect(result.validation.valid).toBe(true);
    expect(result.validation.errors).toEqual([]);

    const xml = flatten(new TextDecoder().decode(result.bytes));

    expect(xml).toContain('<Descrizione>Consulenza strategica</Descrizione>');
    // DatiRiepilogo, grouped by rate — from totals.vatBreakdown, never recomputed.
    expect(xml).toContain(
      '<AliquotaIVA>22.00</AliquotaIVA><ImponibileImporto>1000.00</ImponibileImporto><Imposta>220.00</Imposta>',
    );
    // Line 2's discount (20%) is applied BEFORE this provider ever sees the number: sticker
    // 2×50.00=100.00, discounted net is 80.00, so the 10% bucket sees 80.00/8.00, never 100.00/10.00.
    expect(xml).toContain(
      '<AliquotaIVA>10.00</AliquotaIVA><ImponibileImporto>80.00</ImponibileImporto><Imposta>8.00</Imposta>',
    );
    expect(extractTag(xml, 'ImportoTotaleDocumento')).toBe('1308.00');
  });

  it('1. valid 7-char IT_SDI code wins → CodiceDestinatario = that code, no PECDestinatario', async () => {
    const buyer: DocumentFormatParty = {
      ...BUYER,
      partyIdentifiers: [...BUYER.partyIdentifiers, { scheme: 'IT_SDI', value: 'abc123x' }],
    };
    const result = await fatturapaFormatProvider.build(descriptor, document(VALID_DATA), SELLER, buyer);
    const xml = new TextDecoder().decode(result.bytes);
    expect(extractTag(xml, 'CodiceDestinatario')).toBe('ABC123X');
    expect(xml).not.toContain('PECDestinatario');
  });

  it('2. no IT_SDI but a PEC on file → CodiceDestinatario = 0000000 + PECDestinatario emitted, and the whole document is still XSD-valid', async () => {
    const buyer: DocumentFormatParty = {
      ...BUYER,
      partyIdentifiers: [
        { scheme: 'VAT', value: 'IT98765432109' },
        { scheme: 'PEC', value: 'bianchi@pec.it' },
      ],
    };
    const result = await fatturapaFormatProvider.build(descriptor, document(VALID_DATA), SELLER, buyer);
    const xml = new TextDecoder().decode(result.bytes);
    expect(extractTag(xml, 'CodiceDestinatario')).toBe('0000000');
    expect(extractTag(xml, 'PECDestinatario')).toBe('bianchi@pec.it');
    expect(result.validation.valid).toBe(true);
  });

  it('4. domestic IT, neither code nor PEC on file → XXXXXXX (never 0000000 without a PEC)', async () => {
    const buyer: DocumentFormatParty = {
      ...BUYER,
      partyIdentifiers: [{ scheme: 'VAT', value: 'IT98765432109' }],
    };
    const result = await fatturapaFormatProvider.build(descriptor, document(VALID_DATA), SELLER, buyer);
    const xml = new TextDecoder().decode(result.bytes);
    expect(extractTag(xml, 'CodiceDestinatario')).toBe('XXXXXXX');
    expect(xml).not.toContain('PECDestinatario');
    expect(result.validation.valid).toBe(true);
  });

  // ── FPA12 (government recipient) — the two named gaps `3cb39f91` left open, closed here ──
  // See fatturapa-provider.ts's own header ("FPA12 vs FPR12") for the discriminant chosen (a valid
  // 6-char `IT_PA_CODE` party identifier, never `Client.kind`) and the XSD verification.
  it('PA: a valid 6-char IT_PA_CODE on the client wins outright → FPA12 (versione + FormatoTrasmissione), CodiceDestinatario = that code, judged by the SAME real XSD', async () => {
    const buyer: DocumentFormatParty = {
      ...BUYER,
      partyIdentifiers: [...BUYER.partyIdentifiers, { scheme: 'IT_PA_CODE', value: 'abc123' }],
    };
    const result = await fatturapaFormatProvider.build(descriptor, document(VALID_DATA), SELLER, buyer);
    const xml = new TextDecoder().decode(result.bytes);

    expect(xml).toMatch(/versione="FPA12"/);
    expect(extractTag(xml, 'FormatoTrasmissione')).toBe('FPA12');
    // Uppercased, same convention the existing IT_SDI test already proves for the B2B branch.
    expect(extractTag(xml, 'CodiceDestinatario')).toBe('ABC123');
    expect(xml).not.toContain('PECDestinatario');

    // The REAL vendored XSD — the SAME `Schema_VFPR12.xsd` used for every FPR12 case above (see this
    // provider's own header: it judges BOTH transmission formats, confirmed directly against the two
    // schemas fatturapa.gov.it itself publishes today for its 1.2.3 revision). Never asserted against
    // a B2B-only schema that would wrongly reject this.
    expect(result.validation.valid).toBe(true);
    expect(result.validation.errors).toEqual([]);
  });

  it('PA code wins outright even when a 7-char IT_SDI is ALSO on file — a client is never routed as both PA and B2B at once', async () => {
    const buyer: DocumentFormatParty = {
      ...BUYER,
      partyIdentifiers: [
        ...BUYER.partyIdentifiers,
        { scheme: 'IT_SDI', value: 'abc123x' },
        { scheme: 'IT_PA_CODE', value: 'UFE0A1' },
      ],
    };
    const result = await fatturapaFormatProvider.build(descriptor, document(VALID_DATA), SELLER, buyer);
    const xml = new TextDecoder().decode(result.bytes);
    expect(extractTag(xml, 'FormatoTrasmissione')).toBe('FPA12');
    expect(extractTag(xml, 'CodiceDestinatario')).toBe('UFE0A1');
    expect(result.validation.valid).toBe(true);
  });

  it('an IT_PA_CODE that is NOT exactly 6 characters never fires the PA branch — falls through to the ordinary B2B routing, FPR12 unchanged (regression: same fallback "4." already proves)', async () => {
    const buyer: DocumentFormatParty = {
      ...BUYER,
      partyIdentifiers: [...BUYER.partyIdentifiers, { scheme: 'IT_PA_CODE', value: 'TOOLONG7' }],
    };
    const result = await fatturapaFormatProvider.build(descriptor, document(VALID_DATA), SELLER, buyer);
    const xml = new TextDecoder().decode(result.bytes);
    expect(extractTag(xml, 'FormatoTrasmissione')).toBe('FPR12');
    expect(extractTag(xml, 'CodiceDestinatario')).toBe('XXXXXXX');
  });

  it('MUTATION-STYLE PROOF: stripping a mandatory field (Data, the document date) from an otherwise-valid document makes the SAME schema reject it', async () => {
    const result = await fatturapaFormatProvider.build(descriptor, document(VALID_DATA), SELLER, BUYER);
    expect(result.validation.valid).toBe(true);
    const validXml = new TextDecoder().decode(result.bytes);

    const mutatedXml = validXml.replace(/<Data>[^<]*<\/Data>/, '');
    expect(mutatedXml).not.toBe(validXml);

    const directResult = await validateXsd(mutatedXml, 'it/Schema_VFPR12.xsd');
    expect(directResult.valid).toBe(false);
    expect(directResult.errors.length).toBeGreaterThan(0);
    expect(directResult.errors.join(' ')).toMatch(/Data/);
  });

  // REGRESSION — Peppol BIS rule R002: `peppol-post-process.ts#mergePeppolNotesInObject` is wired ONLY into
  // `peppol-bis-provider.ts` (see that file's own header). This provider never calls
  // `build-semantic-invoice.ts`/`shared-build.ts` at all — it has no `cbc:Note`/mentions concept
  // whatsoever (`@digitalia/fatturapa`'s own FatturaPA XML has no equivalent field this codebase
  // fills) — so a French seller carrying the three C. com. mentions (`countries/data/fr.json (section "mentions")`) that
  // the Peppol fix exists for builds here EXACTLY as before: unaffected, because there was never
  // anything for the fix to touch on this path.
  it('a French seller (the same one Peppol BIS now merges notes for) still builds a valid FatturaPA document — untouched, this provider has no note mechanism at all', async () => {
    const frenchSeller: DocumentFormatParty = {
      name: 'Dupont Consulting SARL',
      address: '12 Rue de la Paix',
      city: 'Paris',
      postalCode: '75002',
      country: 'France',
      email: 'contact@dupont-consulting.example',
      partyIdentifiers: [
        { scheme: 'VAT', value: 'FR12345678901' },
        { scheme: 'LEGAL_ID', value: '12345678900017' },
      ],
    };
    const result = await fatturapaFormatProvider.build(descriptor, document(VALID_DATA), frenchSeller, BUYER);
    expect(result.validation.valid).toBe(true);
    expect(result.validation.errors).toEqual([]);

    // No note/mention artifact of any kind leaked in — this format simply does not carry BG-1.
    const xml = new TextDecoder().decode(result.bytes);
    expect(xml).not.toContain('PMT');
    expect(xml).not.toContain('frais de recouvrement');
  });

  // SECURITY — `@digitalia/fatturapa@1.3.1` pins `fast-xml-parser@3.21.1` (`npm ls fast-xml-parser`
  // shows exactly this one path in the tree; `npm audit` reports it `fixAvailable: false` for that
  // reason — no version bump of ours removes it). Its advisory, "XMLBuilder: XML Comment and CDATA
  // Injection via Unescaped Delimiters" (GHSA-gh4j-gqv2-49f6), is real here: verified directly
  // against the vendored copy, `fast-xml-parser@3.21.1`'s builder escapes NOTHING in a string it is
  // given (no default `tagValueProcessor`, and `@digitalia/fatturapa`'s own `parserOptions` never
  // sets one). `fatturapa-xml-guard.ts#escapeXmlTree` closes this at the one call site that matters
  // — see that file's own header and `fatturapa-provider.ts`'s call to it.
  describe('SECURITY — free text carrying XML comment/CDATA delimiters', () => {
    it('still builds a document that is well-formed XML AND whose ORIGINAL text is recoverable, unmangled', async () => {
      // The delimiter class the advisory concerns (`<!-- -->`, `]]>`), plus the other XML
      // metacharacters (`&`, `"`) — none of this is a working exploit, just the character classes
      // `escapeXmlText` neutralises. See this file's own header comment for the advisory reference.
      const description = 'Contratto rif. <!-- v2 --> nota "finale" A&B ]]> validità 2024 --> 2025';
      const data = { ...VALID_DATA, lines: [{ ...VALID_DATA.lines[0], description }] };

      const result = await fatturapaFormatProvider.build(descriptor, document(data), SELLER, BUYER);

      // 1. The REAL vendored XSD, judged via xmllint-wasm (real libxml2, not a regex) — this is the
      //    same gate every other test in this file relies on, and it necessarily parses the XML
      //    before it can validate it, so a syntax error here would already fail this assertion.
      expect(result.validation.valid).toBe(true);
      expect(result.validation.errors).toEqual([]);

      // 2. A SECOND, independent XML engine — `xmlbuilder2`, the library every OTHER format
      //    provider in this codebase (CII/UBL/Factur-X/XRechnung/Peppol BIS via `@e-invoice-eu/core`,
      //    and FA3 directly) already depends on, and which never ran `escapeXmlText`'s own code —
      //    parses the built document into a real DOM. Its `textContent` decodes XML entities back,
      //    proving the human (or SdI) reading this invoice sees the EXACT original description, not
      //    a truncated or re-escaped one.
      const xml = new TextDecoder().decode(result.bytes);
      // `.node` is typed as the generic DOM `Node` by xmlbuilder2; it is actually a `Document` here.
      const dom = create(xml).node as unknown as Document;
      const descrizioneEl = dom.getElementsByTagName('Descrizione')[0];
      expect(descrizioneEl.textContent).toBe(description);
    });

    it('an ORDINARY description (no XML metacharacters) still produces the SAME output the provider always has', async () => {
      // No new escaping fires on text that never contained `&`, `<`, `>`, `"` or `'` — this is the
      // SAME assertion the very first test in this file already makes; repeated here, next to the
      // security test above, to make the "costs nothing on the normal path" property explicit.
      const result = await fatturapaFormatProvider.build(descriptor, document(VALID_DATA), SELLER, BUYER);
      const xml = new TextDecoder().decode(result.bytes);
      expect(xml).toContain('<Descrizione>Consulenza strategica</Descrizione>');
    });
  });

  // ── The routing is only as good as the data it is given ────────────────────────────────────────
  // The routing below has always been correct: the tests above prove `IT_SDI`/`PEC`/`IT_PA_CODE` are
  // read and routed properly once present on a `DocumentFormatParty`. What was missing sat one layer
  // up. `client-upsert.tsx` renders ONE `<Input>` per scheme `countries/data/it.json (section "identifiers")`
  // declares for the party's country, and that file long declared only `VAT`/`LEGAL_ID` — so no
  // screen could ever put an `IT_SDI` (or `IT_PA_CODE`, or `PEC`) on a real client record, and a
  // genuinely domestic Italian B2B client fell through EVERY branch to the last one:
  // `CodiceDestinatario: 'XXXXXXX'`, the placeholder this same specification reserves for "soggetti
  // non residenti, non stabiliti, non identificati in Italia" (quoted in full in this provider's own
  // header). A domestic recipient was announced to SdI as a foreign one.
  //
  // Both halves are pinned here, because either alone would let it regress: the catalog declares the
  // schemes (without which the form cannot collect them), and a collected value still routes.
  describe('Italian recipient codes are declared by the catalog, and route once collected', () => {
    it('countries/data/it.json (section "identifiers") declares IT_SDI, IT_PA_CODE and PEC — without which client-upsert.tsx renders no field for them at all', () => {
      const itFile = ALL_COUNTRY_IDENTIFIER_FILES.find((f) => f.countryCode === 'IT');
      expect(itFile).toBeDefined();
      const schemes = (itFile?.schemes ?? []).map((s) => s.scheme);
      expect(schemes).toContain('IT_SDI');
      expect(schemes).toContain('IT_PA_CODE');
      expect(schemes).toContain('PEC');
    });

    it('a domestic Italian B2B client carrying the now-collectable IT_SDI identifier produces FormatoTrasmissione = FPR12 and that code as CodiceDestinatario — NEVER XXXXXXX (the foreign-recipient placeholder)', async () => {
      const domesticBuyer: DocumentFormatParty = {
        ...BUYER,
        country: 'Italy',
        partyIdentifiers: [
          { scheme: 'VAT', value: 'IT98765432109' },
          { scheme: 'IT_SDI', value: 'ABCDEFG' },
        ],
      };
      const result = await fatturapaFormatProvider.build(
        descriptor,
        document(VALID_DATA),
        SELLER,
        domesticBuyer,
      );
      const xml = new TextDecoder().decode(result.bytes);

      expect(extractTag(xml, 'FormatoTrasmissione')).toBe('FPR12');
      expect(extractTag(xml, 'CodiceDestinatario')).toBe('ABCDEFG');
      expect(extractTag(xml, 'CodiceDestinatario')).not.toBe('XXXXXXX');
      expect(result.validation.valid).toBe(true);
    });
  });

  // THE MUTATION TARGET: `mapNatura` used to decide N2 vs. N6 purely from the CLIENT's own country —
  // it had no way to tell `it-esente` (DPR 633/72 art. 10, no input-VAT deduction right) apart from
  // `it-non-imponibile` (art. 8, deduction right preserved), since both resolve to the exact same 0%.
  // A domestic Italian invoice choosing either regime now carries the CORRECT Natura on both the
  // per-line DettaglioLinee AND the aggregated DatiRiepilogo — still judged by the real vendored XSD.
  describe('Natura is derived from the CATALOG entry actually chosen, not guessed from the bare 0% rate', () => {
    function domesticZeroRateData(vatRate: string) {
      return {
        client: 'client-1',
        issueDate: '2026-09-15',
        dueDate: '2026-10-15',
        currency: 'EUR',
        lines: [{ description: 'Prestazione', quantity: 1, unit: 'unit', unitPrice: 500, vatRate }],
      };
    }

    it('it-esente (art. 10 DPR 633/72, EXEMPT) → Natura N4, on both DettaglioLinee and DatiRiepilogo', async () => {
      const result = await fatturapaFormatProvider.build(
        descriptor,
        document(domesticZeroRateData('it-esente')),
        SELLER,
        BUYER,
      );

      expect(result.validation.valid).toBe(true);
      expect(result.validation.errors).toEqual([]);
      const xml = flatten(new TextDecoder().decode(result.bytes));

      // DettaglioLinee — the per-line detail. `RiferimentoNormativo` is NOT a valid child of
      // DettaglioLinee at all (the vendored `Schema_VFPR12.xsd`'s own `DettaglioLineeType`) — `Natura`
      // is the line's own last element here.
      expect(xml).toContain('<AliquotaIVA>0.00</AliquotaIVA><Natura>N4</Natura></DettaglioLinee>');
      // DatiRiepilogo — the aggregated summary. Schema order: AliquotaIVA, Natura?, ImponibileImporto,
      // Imposta, EsigibilitaIVA?, RiferimentoNormativo? (`DatiRiepilogoType`) — Natura right after the
      // rate, RiferimentoNormativo LAST, never grouped together at the end.
      expect(xml).toContain(
        '<AliquotaIVA>0.00</AliquotaIVA><Natura>N4</Natura><ImponibileImporto>500.00</ImponibileImporto><Imposta>0.00</Imposta><EsigibilitaIVA>I</EsigibilitaIVA><RiferimentoNormativo>Esente art. 10 DPR 633/72</RiferimentoNormativo>',
      );
    });

    it("it-non-imponibile (art. 8 DPR 633/72, ZERO) → Natura N3 — DISTINCT from it-esente's N4, even though both are 0%", async () => {
      const result = await fatturapaFormatProvider.build(
        descriptor,
        document(domesticZeroRateData('it-non-imponibile')),
        SELLER,
        BUYER,
      );

      expect(result.validation.valid).toBe(true);
      expect(result.validation.errors).toEqual([]);
      const xml = flatten(new TextDecoder().decode(result.bytes));

      expect(xml).toContain('<AliquotaIVA>0.00</AliquotaIVA><Natura>N3</Natura>');
      expect(xml).toContain('<RiferimentoNormativo>Non imponibile art. 8 DPR 633/72</RiferimentoNormativo>');
      expect(xml).not.toContain('<Natura>N4</Natura>');
    });

    it('a plain legacy "0" (no catalog id at all) falls back to the pre-existing client-based heuristic (N2, domestic Italian buyer) — never N3/N4 invented from nothing', async () => {
      const result = await fatturapaFormatProvider.build(
        descriptor,
        document(domesticZeroRateData('0')),
        SELLER,
        BUYER,
      );

      const xml = flatten(new TextDecoder().decode(result.bytes));
      expect(xml).toContain('<AliquotaIVA>0.00</AliquotaIVA><Natura>N2</Natura>');
    });
  });

  // Issue #603 (owner review round): `mapNatura`'s domestic guard used to compare the buyer against
  // the literal `'IT'` - this provider only ever builds for an Italian seller in practice, but the
  // function itself named no country any more once it took `sellerCountry` as its own parameter
  // instead. These three cases exercise the exported function directly, proving it is genuinely
  // parameterized (not just IT re-spelled as a variable) - a seller established somewhere other than
  // Italy would get the exact same domestic/cross-border logic.
  describe('mapNatura - the domestic guard is parameterized by sellerCountry, never a literal', () => {
    it('buyer established in the SAME country as the seller - domestic, never N6, regardless of EU membership', () => {
      expect(mapNatura(0, undefined, 'IT', 'IT12345678901', 'IT')).toBe('N2');
      expect(mapNatura(0, undefined, 'FR', 'FR12345678901', 'FR')).toBe('N2');
    });

    it('buyer in a DIFFERENT EU country than the seller, with a VAT id - cross-border reverse charge, N6', () => {
      expect(mapNatura(0, undefined, 'DE', 'DE123456789', 'IT')).toBe('N6');
      // Symmetric: an Italian buyer is cross-border for a FRENCH seller too - the guard names no
      // country, so this works in both directions.
      expect(mapNatura(0, undefined, 'IT', 'IT12345678901', 'FR')).toBe('N6');
    });

    it('buyer in a non-EU/GCC country - never N6, regardless of the seller', () => {
      expect(mapNatura(0, undefined, 'US', 'US123456789', 'IT')).toBe('N2');
    });
  });
});

describe('fatturapa-provider - currency fallback', () => {
  it('a document with no currency builds the same file as one in EUR, for an Italian seller', async () => {
    const { currency, ...withoutCurrency } = VALID_DATA;
    const withCurrency = await fatturapaFormatProvider.build(descriptor, document(VALID_DATA), SELLER, BUYER);
    const withFallback = await fatturapaFormatProvider.build(
      descriptor,
      document(withoutCurrency),
      SELLER,
      BUYER,
    );

    const xml = new TextDecoder().decode(withFallback.bytes);
    expect(currency).toBe('EUR');
    expect(extractTag(flatten(xml), 'Divisa')).toBe('EUR');
    expect(xml).toBe(new TextDecoder().decode(withCurrency.bytes));
  });
});
