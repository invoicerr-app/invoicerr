/**
 * CII XML post-processor — injects fields required by superpdp/CTC FR that
 * @fin.cx/einvoice does NOT emit.
 *
 * Missing fields (confirmed by comparing @fin.cx/einvoice output against a
 * live superpdp-accepted invoice):
 *   1. SpecifiedLegalOrganization/ID (CTC FR rule BR-CL-3)
 *   2. BusinessProcessSpecifiedDocumentContextParameter/ID=M1
 *   3. TaxBasisTotalAmount (BT-109, BR-CO-15)
 *   4. Header-level ApplicableTradeTax with CalculatedAmount + BasisAmount (BG-23, BR-S-01)
 *   5. Non-empty ApplicableHeaderTradeDelivery with ShipToTradeParty + ActualDeliverySupplyChainEvent
 *   6. GlobalID schemeID="0225" on seller and buyer trade parties
 *   7. URIUniversalCommunication on seller and buyer trade parties
 *
 * schemeID values (AFNOR XP Z12-012):
 *   0002 = SIREN (9 digits — legal entity identifier)
 *   0009 = SIRET (14 digits — establishment identifier)
 *   0225 = Electronic Address Scheme (EAS) code for French PDP routing
 *
 * Source: confirmed against live superpdp sandbox invoice 6715 on 2026-06-28.
 */

export interface CtcLegalId {
  /** The identifier value (SIREN: 9 digits, SIRET: 14 digits). */
  value: string;
  /** schemeID attribute: '0002' (SIREN) or '0009' (SIRET). Default: '0002'. */
  schemeID?: string;
}

export interface CtcPostProcessInput {
  /** SIREN/SIRET of the seller (required for CTC FR). */
  seller?: CtcLegalId;
  /** SIREN/SIRET of the buyer (required for CTC FR). */
  buyer?: CtcLegalId;
}

/**
 * Inject SpecifiedLegalOrganization/ID into CII XML for seller and/or buyer.
 *
 * The injection is done via targeted regex replacement on the SellerTradeParty
 * and BuyerTradeParty sections. It inserts the element right after the opening
 * tag of the trade party, before PostalTradeAddress.
 *
 * Returns the modified XML. If no injection is needed (no SIREN/SIRET provided),
 * the XML is returned unchanged.
 */
export function injectSpecifiedLegalOrganization(
  ciiXml: string,
  input: CtcPostProcessInput,
): string {
  let result = ciiXml;

  if (input.seller) {
    result = injectIntoTradeParty(result, 'SellerTradeParty', input.seller);
  }
  if (input.buyer) {
    result = injectIntoTradeParty(result, 'BuyerTradeParty', input.buyer);
  }

  return result;
}

/**
 * Inject SpecifiedLegalOrganization into a specific trade party section.
 *
 * CII element ordering within SellerTradeParty/BuyerTradeParty:
 *   GlobalID → Name → SpecifiedLegalOrganization → PostalTradeAddress → URIUniversalCommunication → SpecifiedTaxRegistration
 *
 * Strategy: insert AFTER <ram:Name>...</ram:Name> to respect the schema order.
 * Falls back to inserting after the opening tag if Name is not found.
 */
function injectIntoTradeParty(
  xml: string,
  partyName: string, // e.g. 'SellerTradeParty'
  legalId: CtcLegalId,
): string {
  const schemeID = legalId.schemeID ?? '0002';
  const element = `<ram:SpecifiedLegalOrganization><ram:ID schemeID="${schemeID}">${escapeXml(legalId.value)}</ram:ID></ram:SpecifiedLegalOrganization>`;

  // Check if SpecifiedLegalOrganization already exists for this party
  const partySectionRegex = new RegExp(
    `<ram:${escapeRegex(partyName)}>[\\s\\S]*?</ram:${escapeRegex(partyName)}>`,
  );
  const partyMatch = partySectionRegex.exec(xml);
  if (partyMatch && partyMatch[0].includes('SpecifiedLegalOrganization')) {
    // Already present — skip injection
    return xml;
  }

  // Strategy: insert after the party's <ram:Name>...</ram:Name> (CII schema order).
  // Extract the party section to find Name.
  if (partyMatch) {
    const nameRegex = new RegExp(
      `(<ram:${escapeRegex(partyName)}>)([\\s\\S]*?)(<ram:Name>[\\s\\S]*?<\\/ram:Name>)`,
    );
    const nameMatch = nameRegex.exec(xml);
    if (nameMatch) {
      // Insert SpecifiedLegalOrganization right after Name
      return xml.replace(nameRegex, `$1$2$3${element}`);
    }
  }

  // Fallback: insert after opening tag (if Name not found)
  const openTagRegex = new RegExp(
    `(<ram:${escapeRegex(partyName)}>)`,
    'g',
  );
  const openMatch = openTagRegex.exec(xml);
  if (!openMatch) return xml;
  return xml.replace(openTagRegex, `$1${element}`);
}

/**
 * Extract SIREN from the CII XML by reading the FC (French Company) tax registration.
 *
 * CII structure:
 *   <ram:SellerTradeParty>
 *     ...
 *     <ram:SpecifiedTaxRegistration><ram:ID schemeID="FC">315143296</ram:ID></ram:SpecifiedTaxRegistration>
 *   </ram:SellerTradeParty>
 *
 * Returns { seller, buyer } SIREN values found via `schemeID="FC"` in the respective trade parties.
 */
export function extractSirensFromCii(ciiXml: string): { seller?: string; buyer?: string } {
  const sellerSiren = extractFcFromTradeParty(ciiXml, 'SellerTradeParty');
  const buyerSiren = extractFcFromTradeParty(ciiXml, 'BuyerTradeParty');
  return { seller: sellerSiren, buyer: buyerSiren };
}

function extractFcFromTradeParty(xml: string, partyName: string): string | undefined {
  // Extract the party section first
  const sectionRegex = new RegExp(
    `<ram:${escapeRegex(partyName)}>[\\s\\S]*?</ram:${escapeRegex(partyName)}>`,
  );
  const section = sectionRegex.exec(xml)?.[0];
  if (!section) return undefined;

  // Find the FC (French Company) tax registration: <ram:ID schemeID="FC">SIREN</ram:ID>
  // VA-to-SIREN extraction is unreliable: FR{XX}{NIF} where NIF ≠ SIREN in many cases.
  const fcRegex = /<ram:ID\s+schemeID="FC">(\d{9,14})<\/ram:ID>/;
  return fcRegex.exec(section)?.[1];
}

/**
 * Fix CII element ordering to match the UN/CEFACT schema strict sequence.
 *
 * @fin.cx/einvoice produces two ordering violations:
 *   1. ExchangedDocument: TypeCode before ID → must be ID before TypeCode
 *   2. SupplyChainTradeTransaction: line items after headers → must be before headers
 */
function fixCiiElementOrder(ciiXml: string): string {
  let result = ciiXml;

  // 1. Fix ExchangedDocument: ID must come before TypeCode
  result = result.replace(
    /(<rsm:ExchangedDocument>)(\s*<ram:TypeCode>[^<]*<\/ram:TypeCode>)(\s*<ram:ID>[^<]*<\/ram:ID>)/,
    '$1$3$2',
  );

  // 2. Fix SupplyChainTradeTransaction: line items must come before header sections.
  const scttMatch = result.match(
    /(<rsm:SupplyChainTradeTransaction>)([\s\S]*?)(<\/rsm:SupplyChainTradeTransaction>)/,
  );
  if (scttMatch) {
    const inner = scttMatch[2];

    // Extract line items
    const lineItems = [...inner.matchAll(/<ram:IncludedSupplyChainTradeLineItem>[\s\S]*?<\/ram:IncludedSupplyChainTradeLineItem>/g)]
      .map(m => m[0]);

    // Extract header sections (handle both self-closing and expanded forms)
    const headerAgreement = inner.match(/<ram:ApplicableHeaderTradeAgreement>[\s\S]*?<\/ram:ApplicableHeaderTradeAgreement>/)?.[0] ?? '';
    const headerDelivery = inner.match(/<ram:ApplicableHeaderTradeDelivery(?:\s*\/>|>[\s\S]*?<\/ram:ApplicableHeaderTradeDelivery>)/)?.[0] ?? '';
    const headerSettlement = inner.match(/<ram:ApplicableHeaderTradeSettlement>[\s\S]*?<\/ram:ApplicableHeaderTradeSettlement>/)?.[0] ?? '';

    if (lineItems.length > 0 && headerAgreement) {
      // Check if line items are already first
      const firstNonWhitespace = inner.trimStart();
      if (!firstNonWhitespace.startsWith('<ram:IncludedSupplyChainTradeLineItem>')) {
        const newInner = '\n' + lineItems.join('\n') + '\n' +
          headerAgreement + '\n' +
          headerDelivery + '\n' +
          headerSettlement + '\n';
        result = result.replace(
          /<rsm:SupplyChainTradeTransaction>[\s\S]*?<\/rsm:SupplyChainTradeTransaction>/,
          `${scttMatch[1]}${newInner}${scttMatch[3]}`,
        );
      }
    }
  }

  // 3. Fix PostalTradeAddress element ordering per CII XSD TradeAddressType sequence:
  //    PostcodeCode → LineOne → LineTwo → CityName → CountrySubDivisionName → CountryID
  //    @fin.cx/einvoice generates: LineOne → LineTwo → PostcodeCode → CityName → CountryID (wrong)
  //    superpdp performs strict XSD validation and rejects wrong element order.
  result = fixPostalTradeAddressOrder(result);

  return result;
}

/**
 * Reorder PostalTradeAddress children to match CII XSD TradeAddressType sequence.
 * Handles all trade address elements in the header trade agreement sections.
 */
function fixPostalTradeAddressOrder(xml: string): string {
  // CII XSD sequence for TradeAddressType (only the elements we encounter in practice)
  const XSD_ORDER = ['PostcodeCode', 'LineOne', 'LineTwo', 'LineFour', 'LineFive', 'CityName', 'CountrySubDivisionName', 'CountryID'];

  return xml.replace(
    /(<ram:PostalTradeAddress>)([\s\S]*?)(<\/ram:PostalTradeAddress>)/g,
    (_match, open, inner, close) => {
      // Extract all child elements preserving whitespace
      const children: Array<{ tag: string; content: string }> = [];
      const childRegex = /<ram:(\w+)(?:\s[^>]*)?>[\s\S]*?<\/ram:\1>|<ram:(\w+)(?:\s[^>]*)?>(?=<)/g;
      let m: RegExpExecArray | null;
      while ((m = childRegex.exec(inner)) !== null) {
        const tag = m[1] ?? m[2];
        children.push({ tag, content: m[0] });
      }

      // Sort by XSD order position, keep unknown elements at end
      children.sort((a, b) => {
        const ai = XSD_ORDER.indexOf(a.tag);
        const bi = XSD_ORDER.indexOf(b.tag);
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      });

      if (children.length === 0) return _match;
      return open + children.map(c => c.content).join('') + close;
    },
  );
}

export function fixEn16931StructuralGaps(ciiXml: string, opts?: {
  sellerRouting?: string;
  buyerRouting?: string;
}): string {
  let result = ciiXml;

  // 1. Inject BusinessProcessSpecifiedDocumentContextParameter/ID=M1 if missing
  if (!result.includes('BusinessProcessSpecifiedDocumentContextParameter')) {
    result = result.replace(
      /(<ram:GuidelineSpecifiedDocumentContextParameter>)/,
      `<ram:BusinessProcessSpecifiedDocumentContextParameter><ram:ID>M1</ram:ID></ram:BusinessProcessSpecifiedDocumentContextParameter>$1`,
    );
  }

  // 2. Fix @fin.cx/einvoice wrong element name: SpecifiedLineTradeSettlementMonetarySummation → SpecifiedTradeSettlementLineMonetarySummation
  result = result.replace(/SpecifiedLineTradeSettlementMonetarySummation/g, 'SpecifiedTradeSettlementLineMonetarySummation');

  // 3. Inject ram:TaxBasisTotalAmount (BT-109) in HEADER summation if missing.
  const summationMatch = result.match(
    /<ram:SpecifiedTradeSettlementHeaderMonetarySummation>([\s\S]*?)<\/ram:SpecifiedTradeSettlementHeaderMonetarySummation>/,
  );
  if (summationMatch && !summationMatch[1].includes('TaxBasisTotalAmount')) {
    const grandTotalMatch = summationMatch[1].match(/<ram:GrandTotalAmount>([^<]+)<\/ram:GrandTotalAmount>/);
    const taxTotalMatch = summationMatch[1].match(/<ram:TaxTotalAmount[^>]*>([^<]+)<\/ram:TaxTotalAmount>/);

    if (grandTotalMatch && taxTotalMatch) {
      const grand = parseFloat(grandTotalMatch[1]);
      const tax = parseFloat(taxTotalMatch[1]);
      const taxBasis = (grand - tax).toFixed(2);

      result = result.replace(
        /(<ram:SpecifiedTradeSettlementHeaderMonetarySummation>\s*<ram:LineTotalAmount>[^<]+<\/ram:LineTotalAmount>)/,
        `$1<ram:TaxBasisTotalAmount>${taxBasis}</ram:TaxBasisTotalAmount>`,
      );
    }
  }

  // 3. Inject header-level ApplicableTradeTax (BG-23 VAT breakdown) with CalculatedAmount + BasisAmount
  const headerSettlementMatch = result.match(
    /<ram:ApplicableHeaderTradeSettlement>([\s\S]*?)<\/ram:ApplicableHeaderTradeSettlement>/,
  );
  if (headerSettlementMatch && !headerSettlementMatch[1].includes('<ram:ApplicableTradeTax>')) {
    // Extract line-level tax info to build header-level breakdown
    const lineTaxMatches = [...result.matchAll(
      /<ram:ApplicableTradeTax>\s*<ram:TypeCode>([^<]+)<\/ram:TypeCode>\s*<ram:CategoryCode>([^<]+)<\/ram:CategoryCode>\s*(?:<ram:RateApplicablePercent>([^<]+)<\/ram:RateApplicablePercent>)?\s*<\/ram:ApplicableTradeTax>/g,
    )];

    if (lineTaxMatches.length > 0) {
      // Use TaxBasisTotalAmount (already injected) as the total net, or fallback to GrandTotal - TaxTotal
      const taxBasisMatch = result.match(/<ram:TaxBasisTotalAmount>([^<]+)<\/ram:TaxBasisTotalAmount>/);
      const totalNet = taxBasisMatch ? parseFloat(taxBasisMatch[1]) : (() => {
        const gt = result.match(/<ram:GrandTotalAmount>([^<]+)<\/ram:GrandTotalAmount>/);
        const tt = result.match(/<ram:TaxTotalAmount[^>]*>([^<]+)<\/ram:TaxTotalAmount>/);
        return gt && tt ? parseFloat(gt[1]) - parseFloat(tt[1]) : 0;
      })();

      // Get per-line amounts from SpecifiedLineTradeSettlementMonetarySummation (line-level only)
      const lineItems = [...result.matchAll(/<ram:IncludedSupplyChainTradeLineItem>([\s\S]*?)<\/ram:IncludedSupplyChainTradeLineItem>/g)];
      const perLineNet = lineItems.map(item => {
        const m = item[1].match(/<ram:SpecifiedLineTradeSettlementMonetarySummation>[\s\S]*?<ram:LineTotalAmount>([^<]+)<\/ram:LineTotalAmount>/);
        return m ? parseFloat(m[1]) : 0;
      });

      const taxElements = lineTaxMatches.map((m, i) => {
        const [, typeCode, categoryCode, ratePercent] = m;
        const rate = ratePercent ? parseFloat(ratePercent) : 0;
        // For a single-rate invoice, basisAmount = total net; for multi-rate, use per-line amount
        const basisAmount = lineTaxMatches.length === 1
          ? totalNet.toFixed(2)
          : (perLineNet[i] ?? 0).toFixed(2);
        const calculatedAmount = (parseFloat(basisAmount) * rate / 100).toFixed(2);

        return `<ram:ApplicableTradeTax><ram:CalculatedAmount>${calculatedAmount}</ram:CalculatedAmount><ram:TypeCode>${typeCode}</ram:TypeCode><ram:BasisAmount>${basisAmount}</ram:BasisAmount><ram:CategoryCode>${categoryCode}</ram:CategoryCode>${ratePercent ? `<ram:RateApplicablePercent>${ratePercent}</ram:RateApplicablePercent>` : ''}</ram:ApplicableTradeTax>`;
      }).join('');

      // Insert before SpecifiedTradePaymentTerms
      if (result.includes('<ram:SpecifiedTradePaymentTerms>')) {
        result = result.replace(
          /(<ram:SpecifiedTradePaymentTerms>)/,
          `${taxElements}$1`,
        );
      } else if (result.includes('<ram:InvoiceCurrencyCode>')) {
        result = result.replace(
          /(<ram:InvoiceCurrencyCode>)/,
          `${taxElements}$1`,
        );
      }
    }
  }

  // 4a. Inject GlobalID schemeID="0225" (PDP routing identifier = party SIREN) on seller and buyer if missing
  const sellerFc = extractFcFromTradeParty(result, 'SellerTradeParty');
  const buyerFc = extractFcFromTradeParty(result, 'BuyerTradeParty');
  if (sellerFc && !result.match(/<ram:SellerTradeParty>[\s\S]*?<ram:GlobalID/)) {
    result = result.replace(
      /(<ram:SellerTradeParty>)([\s\S]*?)(<ram:(?:Name|PostalTradeAddress|SpecifiedLegalOrganization)>)/,
      `$1<ram:GlobalID schemeID="0225">${escapeXml(sellerFc)}</ram:GlobalID>$2$3`,
    );
  }
  if (buyerFc && !result.match(/<ram:BuyerTradeParty>[\s\S]*?<ram:GlobalID/)) {
    result = result.replace(
      /(<ram:BuyerTradeParty>)([\s\S]*?)(<ram:(?:Name|PostalTradeAddress|SpecifiedLegalOrganization)>)/,
      `$1<ram:GlobalID schemeID="0225">${escapeXml(buyerFc)}</ram:GlobalID>$2$3`,
    );
  }

  // 4b. Inject URIUniversalCommunication schemeID="0225" on seller and buyer if missing.
  // Routing address format: {pdp_siren}_{account_id} (NOT the seller's SIREN!).
  // The pdp_siren is the PDP operator's SIREN (e.g. '315143296' for superpdp sandbox).
  // Use opts.sellerRouting / opts.buyerRouting if provided; fall back to {sellerFc}_1422/1421.
  const sellerRouting = opts?.sellerRouting ?? (sellerFc ? `${sellerFc}_1422` : undefined);
  const buyerRouting = opts?.buyerRouting ?? (sellerFc ? `${sellerFc}_1421` : undefined);
  if (sellerRouting && !result.includes('URIUniversalCommunication')) {
    const sellerTaxReg = result.match(/<ram:SellerTradeParty>[\s\S]*?<ram:SpecifiedTaxRegistration>/);
    if (sellerTaxReg) {
      const uriElement = `<ram:URIUniversalCommunication><ram:URIID schemeID="0225">${escapeXml(sellerRouting)}</ram:URIID></ram:URIUniversalCommunication>`;
      result = result.replace(
        /(<ram:SellerTradeParty>[\s\S]*?)(<ram:SpecifiedTaxRegistration>)/,
        `$1${uriElement}$2`,
      );
    }
  }
  if (buyerRouting && !result.match(/<ram:BuyerTradeParty>[\s\S]*?URIUniversalCommunication/)) {
    const buyerTaxReg = result.match(/<ram:BuyerTradeParty>[\s\S]*?<ram:SpecifiedTaxRegistration>/);
    if (buyerTaxReg) {
      const uriElement = `<ram:URIUniversalCommunication><ram:URIID schemeID="0225">${escapeXml(buyerRouting)}</ram:URIID></ram:URIUniversalCommunication>`;
      result = result.replace(
        /(<ram:BuyerTradeParty>[\s\S]*?)(<ram:SpecifiedTaxRegistration>)/,
        `$1${uriElement}$2`,
      );
    }
  }

  // 4c. Fix empty ApplicableHeaderTradeDelivery — add ShipToTradeParty + ActualDeliverySupplyChainEvent
  if (result.includes('<ram:ApplicableHeaderTradeDelivery/>')) {
    // Extract issue date from ExchangedDocument for ActualDeliverySupplyChainEvent
    const issueDateMatch = result.match(/<udt:DateTimeString format="102">(\d{8})<\/udt:DateTimeString>/);
    const deliveryDate = issueDateMatch?.[1] ?? new Date().toISOString().slice(0, 10).replace(/-/g, '');

    const delivery = `<ram:ApplicableHeaderTradeDelivery><ram:ShipToTradeParty><ram:PostalTradeAddress><ram:CountryID>FR</ram:CountryID></ram:PostalTradeAddress></ram:ShipToTradeParty><ram:ActualDeliverySupplyChainEvent><ram:OccurrenceDateTime><udt:DateTimeString format="102">${deliveryDate}</udt:DateTimeString></ram:OccurrenceDateTime></ram:ActualDeliverySupplyChainEvent></ram:ApplicableHeaderTradeDelivery>`;
    result = result.replace('<ram:ApplicableHeaderTradeDelivery/>', delivery);
  }

  return result;
}

/**
 * Normalize CII namespace style from prefix-based (rsm:, ram:, udt:) to
 * default-namespace-per-element (as superpdp expects).
 *
 * Prefix mapping:
 *   rsm: → urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100
 *   ram: → urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100
 *   udt: → urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100
 */
function normalizeCiiNamespaces(ciiXml: string): string {
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

  // Handle self-closing tags with attributes: <ram:ApplicableHeaderTradeDelivery/>
  // These don't need xmlns (they're already handled by parent)

  return result;
}

/**
 * Convenience: extract SIRENs from CII XML, inject SpecifiedLegalOrganization,
 * fix EN16931 structural gaps, normalize element ordering, and normalize namespace style.
 * Returns the patched XML. This is the primary entry point for the PDP transmit flow.
 *
 * @param opts.sellerRouting - Seller's PDP routing address (e.g., '315143296_1422').
 *   Format: {pdp_siren}_{account_id}. If not provided, falls back to {sellerSiren}_1422.
 * @param opts.buyerRouting  - Buyer's PDP routing address (e.g., '315143296_1421').
 *   If not provided, falls back to {sellerSiren}_1421 (seller's PDP account).
 */
export function postProcessCiiForCtc(ciiXml: string, opts?: {
  sellerRouting?: string;
  buyerRouting?: string;
}): string {
  let result = ciiXml;

  // 0. Fix CII element ordering (must come first — before other injections)
  result = fixCiiElementOrder(result);

  // 1. CTC FR: inject SpecifiedLegalOrganization
  const { seller, buyer } = extractSirensFromCii(result);
  if (seller || buyer) {
    result = injectSpecifiedLegalOrganization(result, {
      seller: seller ? { value: seller, schemeID: '0002' } : undefined,
      buyer: buyer ? { value: buyer, schemeID: '0002' } : undefined,
    });
  }

  // 2. Fix EN16931 structural gaps (BR-CO-15, BR-S-01, delivery, GlobalID, URI)
  result = fixEn16931StructuralGaps(result, { sellerRouting: opts?.sellerRouting, buyerRouting: opts?.buyerRouting });

  // 3. Remove FC tax registration (superpdp only accepts VA; FC causes parse failures)
  result = result.replace(/<ram:SpecifiedTaxRegistration>\s*<ram:ID\s+schemeID="FC">[^<]*<\/ram:ID>\s*<\/ram:SpecifiedTaxRegistration>/g, '');

  // 3b. Strip empty optional address elements that cause superpdp XSD validation failures
  //     (<LineTwo/> with empty content fails strict TextType minLength=1 check)
  result = result.replace(/<ram:LineTwo\s*\/>/g, '');
  result = result.replace(/<ram:LineTwo\s*><\/ram:LineTwo>/g, '');

  // 4. Normalize namespace style: rsm:/ram:/udt: prefixes → inline xmlns= per element (superpdp requirement)
  result = normalizeCiiNamespaces(result);

  return result;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
