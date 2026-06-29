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
  if (!ciiXml.includes('rsm:') && !ciiXml.includes('ram:') && !ciiXml.includes('udt:')) {
    return ciiXml;
  }

  const NS = {
    rsm: 'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100',
    ram: 'urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100',
    udt: 'urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100',
  };

  let result = ciiXml;

  // Strip namespace prefix declarations from root element
  result = result.replace(/\s+xmlns:rsm="[^"]*"/, '');
  result = result.replace(/\s+xmlns:ram="[^"]*"/, '');
  result = result.replace(/\s+xmlns:udt="[^"]*"/, '');

  // Also strip xsi declarations and schemaLocation (not needed after normalization)
  result = result.replace(/\s+xmlns:qdt="[^"]*"/, '');
  result = result.replace(/\s+xmlns:xsi="[^"]*"/, '');
  result = result.replace(/\s+xsi:schemaLocation="[^"]*"/, '');

  // Add xmlns= on root element
  result = result.replace(
    /<rsm:CrossIndustryInvoice/,
    `<CrossIndustryInvoice xmlns="${NS.rsm}"`,
  );
  result = result.replace(/<\/rsm:CrossIndustryInvoice>/g, '</CrossIndustryInvoice>');

  // Replace opening tags: <rsm:XXX → <XXX xmlns="..."
  result = result.replace(/<rsm:(\w+)/g, (_m, tag) => `<${tag} xmlns="${NS.rsm}"`);
  // Replace closing tags: </rsm:XXX → </XXX
  result = result.replace(/<\/rsm:(\w+)/g, '</$1');

  // Replace opening tags: <ram:XXX → <XXX xmlns="..."
  result = result.replace(/<ram:(\w+)/g, (_m, tag) => `<${tag} xmlns="${NS.ram}"`);
  // Replace closing tags: </ram:XXX → </XXX
  result = result.replace(/<\/ram:(\w+)/g, '</$1');

  // Replace opening tags: <udt:XXX → <XXX xmlns="..."
  result = result.replace(/<udt:(\w+)/g, (_m, tag) => `<${tag} xmlns="${NS.udt}"`);
  // Replace closing tags: </udt:XXX → </XXX
  result = result.replace(/<\/udt:(\w+)/g, '</$1');

  return result;
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
export function postProcessCiiForCtc(ciiXml: string, opts?: {
  sellerRouting?: string;
  buyerRouting?: string;
}): string {
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

  // 2. Normalize namespace style: rsm:/ram:/udt: → inline xmlns= per element (superpdp requirement).
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

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
