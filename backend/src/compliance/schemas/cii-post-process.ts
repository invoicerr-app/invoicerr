/**
 * CII XML post-processor for superpdp/CTC FR.
 *
 * @e-invoice-eu/core generates conformant EN16931 CII including:
 *   - SpecifiedLegalOrganization/ID (schemeID="0002") from cbc:CompanyID
 *   - BusinessProcessSpecifiedDocumentContextParameter/ID=M1 from cbc:ProfileID
 *   - GlobalID schemeID="0225" from cbc:EndpointID
 *   - URIUniversalCommunication from cbc:EndpointID
 *   - ApplicableHeaderTradeDelivery with ActualDeliverySupplyChainEvent
 *
 * The only remaining transformation: normalize namespace style from
 * prefix-based (rsm:, ram:, udt:) to default-namespace-per-element,
 * which superpdp requires and is not configurable in the library.
 *
 * schemeID values (AFNOR XP Z12-012):
 *   0002 = SIREN (9 digits)
 *   0009 = SIRET (14 digits)
 *   0225 = Electronic Address Scheme for French PDP routing
 */

/**
 * Normalize CII namespace style from prefix-based (rsm:, ram:, udt:) to
 * default-namespace-per-element (as superpdp expects).
 *
 * Prefix mapping:
 *   rsm: → urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100
 *   ram: → urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100
 *   udt: → urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100
 */
export function normalizeCiiNamespaces(ciiXml: string): string {
  // If already using default namespaces (no prefix), skip
  if (
    !ciiXml.includes('rsm:') &&
    !ciiXml.includes('ram:') &&
    !ciiXml.includes('udt:') &&
    !ciiXml.includes('qdt:')
  ) {
    return ciiXml;
  }

  const NS = {
    rsm: 'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100',
    ram: 'urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100',
    udt: 'urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100',
    // Was declared-then-stripped but never rewritten, so every qdt: element left with an UNDECLARED
    // prefix. Invisible until a document actually used one: BT-26 (the corrected invoice's date) is
    // the first, and superpdp named it exactly — "Element 'qdt:DateTimeString': This element is not
    // expected. Expected is ( {…QualifiedDataType:100}DateTimeString )".
    qdt: 'urn:un:unece:uncefact:data:standard:QualifiedDataType:100',
  };

  let result = ciiXml;

  // Strip namespace prefix declarations from root element
  result = result.replace(/\s+xmlns:rsm="[^"]*"/, '');
  result = result.replace(/\s+xmlns:ram="[^"]*"/, '');
  result = result.replace(/\s+xmlns:udt="[^"]*"/, '');

  result = result.replace(/\s+xmlns:qdt="[^"]*"/, '');
  // Also strip xsi declarations and schemaLocation (not needed after normalization)
  result = result.replace(/\s+xmlns:xsi="[^"]*"/, '');
  result = result.replace(/\s+xsi:schemaLocation="[^"]*"/, '');

  // Add xmlns= on root element
  result = result.replace(/<rsm:CrossIndustryInvoice/, `<CrossIndustryInvoice xmlns="${NS.rsm}"`);
  result = result.replace(/<\/rsm:CrossIndustryInvoice>/g, '</CrossIndustryInvoice>');

  // Replace opening tags: <rsm:XXX → <XXX xmlns="..."
  result = result.replace(/<rsm:(\w+)/g, (_m, tag) => `<${tag} xmlns="${NS.rsm}"`);
  // Replace closing tags: </rsm:XXX → </XXX
  result = result.replace(/<\/rsm:(\w+)/g, '</$1');

  // Replace opening tags: <ram:XXX → <XXX xmlns="..."
  result = result.replace(/<ram:(\w+)/g, (_m, tag) => `<${tag} xmlns="${NS.ram}"`);
  // Replace closing tags: </ram:XXX → </XXX
  result = result.replace(/<\/ram:(\w+)/g, '</$1');

  // Replace opening tags: <qdt:XXX → <XXX xmlns="..."
  result = result.replace(/<qdt:(\w+)/g, (_m, tag) => `<${tag} xmlns="${NS.qdt}"`);
  // Replace closing tags: </qdt:XXX → </XXX
  result = result.replace(/<\/qdt:(\w+)/g, '</$1');

  // Replace opening tags: <udt:XXX → <XXX xmlns="..."
  result = result.replace(/<udt:(\w+)/g, (_m, tag) => `<${tag} xmlns="${NS.udt}"`);
  // Replace closing tags: </udt:XXX → </XXX
  result = result.replace(/<\/udt:(\w+)/g, '</$1');

  return result;
}

/**
 * Split the one-note-many-contents block the generator emits into one note per mention.
 *
 * `@fin.cx/einvoice` maps an array of `cbc:Note` onto a SINGLE `ram:IncludedNote` holding several
 * `ram:Content`. That is invalid CII — `Content` occurs at most once in a note — and superpdp says so
 * in as many words: "Element 'ram:Content' must occur exactly 1 times", pointing at
 * `ExchangedDocument/IncludedNote`. Measured, not deduced: three French mentions in, one note with
 * three contents out.
 *
 * The same pass recovers BT-21. EN 16931 UBL carries the subject code as a `#CODE#` prefix on the
 * note text (the shape BR-CL-08 validates); CII wants it as its own `ram:SubjectCode`, and the
 * generator does not translate between the two, so the prefix was travelling into CII as literal
 * text. Element order follows the CII NoteType sequence — `Content` then `SubjectCode`.
 *
 * A no-op when there is nothing to split, so it is safe to run on any CII document.
 */
export function splitCiiIncludedNotes(ciiXml: string): string {
  return ciiXml.replace(/<ram:IncludedNote>([\s\S]*?)<\/ram:IncludedNote>/g, (whole, inner: string) => {
    const contents = [...String(inner).matchAll(/<ram:Content>([\s\S]*?)<\/ram:Content>/g)].map((m) => m[1]);
    // Leave a well-formed note alone — including one that already carries a SubjectCode.
    if (contents.length <= 1 && !/^#[A-Z0-9]{3}#/.test(contents[0] ?? '')) return whole;

    return contents
      .map((raw) => {
        const m = raw.match(/^#([A-Z0-9]{3})#([\s\S]*)$/);
        const text = m ? m[2] : raw;
        const code = m ? m[1] : undefined;
        return code
          ? `<ram:IncludedNote><ram:Content>${text}</ram:Content><ram:SubjectCode>${code}</ram:SubjectCode></ram:IncludedNote>`
          : `<ram:IncludedNote><ram:Content>${text}</ram:Content></ram:IncludedNote>`;
      })
      .join('');
  });
}

/**
 * Post-process CII XML for the French CTC (Contrôle de Conformité Technique).
 *
 * @e-invoice-eu/core emits GlobalID schemeID="0225" and URIUniversalCommunication/URIID
 * from the EndpointID in the Invoice data. For FR PDP, the EndpointID in InvoiceRenderData
 * is the company's SIREN (used for SpecifiedLegalOrganization); the PDP routing address
 * ({pdp_siren}_{account_id}) is only known to the PDP transmission provider.
 *
 * This function replaces the SIREN-valued GlobalID/URIID with the actual routing address
 * when provided, then normalizes namespace style as required by superpdp.
 *
 * @param opts.sellerRouting - Seller PDP routing address (e.g. '315143296_1422').
 * @param opts.buyerRouting  - Buyer PDP routing address (e.g. '315143296_1421').
 */
export function postProcessCiiForCtc(
  ciiXml: string,
  opts?: {
    sellerRouting?: string;
    buyerRouting?: string;
  },
): string {
  let result = ciiXml;

  // 1. Update GlobalID schemeID="0225" and URIUniversalCommunication/URIID
  //    with PDP routing addresses (before namespace normalization so regexes are simple).
  if (opts?.sellerRouting) {
    const routing = escapeXml(opts.sellerRouting);
    // Replace GlobalID in SellerTradeParty
    result = result.replace(
      /(<ram:SellerTradeParty>[\s\S]*?<ram:GlobalID schemeID="0225">)[^<]*(<\/ram:GlobalID>)/,
      `$1${routing}$2`,
    );
    // Replace URIID in URIUniversalCommunication in SellerTradeParty
    result = result.replace(
      /(<ram:SellerTradeParty>[\s\S]*?<ram:URIUniversalCommunication>[\s\S]*?<ram:URIID[^>]*>)[^<]*(<\/ram:URIID>)/,
      `$1${routing}$2`,
    );
  }
  if (opts?.buyerRouting) {
    const routing = escapeXml(opts.buyerRouting);
    // Replace GlobalID in BuyerTradeParty
    result = result.replace(
      /(<ram:BuyerTradeParty>[\s\S]*?<ram:GlobalID schemeID="0225">)[^<]*(<\/ram:GlobalID>)/,
      `$1${routing}$2`,
    );
    // Replace URIID in URIUniversalCommunication in BuyerTradeParty
    result = result.replace(
      /(<ram:BuyerTradeParty>[\s\S]*?<ram:URIUniversalCommunication>[\s\S]*?<ram:URIID[^>]*>)[^<]*(<\/ram:URIID>)/,
      `$1${routing}$2`,
    );
  }

  // 2. One note per mention, and BT-21 where CII expects it. Before namespace normalization, which
  //    rewrites the prefixes these regexes match on.
  result = splitCiiIncludedNotes(result);

  // 3. Normalize namespace style: rsm:/ram:/udt: → inline xmlns= per element (superpdp requirement).
  return normalizeCiiNamespaces(result);
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
