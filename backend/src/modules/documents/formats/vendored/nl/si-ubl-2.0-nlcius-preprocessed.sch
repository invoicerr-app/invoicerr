<?xml version="1.0" encoding="UTF-8"?>
<!--
  Vendored from peppolautoriteit-nl/validation (Peppol Autoriteit NL / Stichting Simplerinvoicing)
  @ tag 2025-11-27 (SI-UBL 2.0 / NLCIUS 2.0.3.12 — release note: "This release is in effect as of
  February 23, 2026", already in effect at fetch time), fetched 2026-09-05 from:
    https://raw.githubusercontent.com/peppolautoriteit-nl/validation/2025-11-27/schematron/si-ubl-2.0.sch
    https://raw.githubusercontent.com/peppolautoriteit-nl/validation/2025-11-27/schematron/si-ubl-2.0/si-ubl-2.0-nlcius.sch
  LICENSE.txt (MIT, Copyright (c) 2017 Stichting Simplerinvoicing) copied VERBATIM alongside this
  file, `vendored/nl/LICENSE.txt` — the MIT attribution requirement.

  TAG CHOICE, deliberately not the repo's most recent tag: `2025-11-27` (`prerelease: false` on
  GitHub) was picked over the newer `2026-05-21` tag (flagged `prerelease: true` on GitHub, release
  note "This release will be in effect as of August 17, 2026" — the SAME underlying CEN PC 434 rules
  update, 1.3.15 → 1.3.16, that this repo's OWN `../en16931/EN16931-UBL-validation-preprocessed.sch`
  already carries, see below) precisely BECAUSE the task asks for the "dernier tag STABLE" — a tag
  the origin repository itself does not mark as a pre-release, not merely the newest ref. The two
  tags carry byte-IDENTICAL `si-ubl-2.0-nlcius.sch` content (the NLCIUS-specific BR-NL-* rules below
  are untouched by either release note, both of which only describe an EN 16931 BASE-rule bump) —
  see the CONTENT PROVENANCE section below for why the base bump is irrelevant to this vendored file
  regardless.

  ## What is, and is NOT, vendored here — never a whole-repo copy

  This repo runs every EN 16931 UBL syntax against the SAME already-vendored base Schematron
  (`../en16931/EN16931-UBL-validation-preprocessed.sch`, CEN PC 434 release 1.3.16) PLUS a national
  delta (`../de/XRechnung-UBL-validation-preprocessed.sch` for XRechnung, `../peppol/
  PEPPOL-EN16931-UBL.sch` for Peppol BIS) — see `../validate-schematron.ts`'s own header and
  `../xrechnung-provider.ts`'s own "DÉCISION" section. `schematron/si-ubl-2.0.sch` (the origin
  repo's own top-level file) is NOT structured that way: it bundles its OWN copy of the base EN
  16931 UBL rules via five `<include>`s (`si-ubl-2.0/CenPC434/{abstract,UBL,codelist}/*.sch`) before
  including the NLCIUS-specific delta. Re-vendoring that bundled base copy here would (a) duplicate,
  under a different filename, a ruleset this repo already vendors and already runs on EVERY UBL
  syntax's own build (`en16931/EN16931-UBL-validation-preprocessed.sch`), (b) risk two slightly
  different CEN PC 434 snapshots silently drifting (this repo's own base is release 1.3.16, per its
  own header, "2026-04-10" — one point release AHEAD of the 1.3.15 this NL repo's `2025-11-27` tag
  bundles, per that release's own changelog quoted in the `TAG CHOICE` note above), and (c) run the
  base ruleset TWICE per NLCIUS build for no additional coverage — exactly the redundancy
  `xrechnung-provider.ts`'s own header already refuses for XRechnung's sibling KoSIT delta. Only the
  two NLCIUS-SPECIFIC pieces are vendored below, unchanged in substance from the origin files, and
  run ON TOP OF this repo's own already-vendored base (`../nlcius-provider.ts`'s own header: "BOTH
  gates run, and BOTH must pass").

  ## The two pieces, composed here (include inlining — the SAME transformation `../de/XRechnung-
  ## UBL-validation-preprocessed.sch`'s own header already documents for KoSIT's `common.sch`)

   1. `schematron/si-ubl-2.0.sch`'s OWN inline pattern, `id="SI-UBL-VERSION"` (that file's lines
      ~27-38, never itself an `<include>` target — copied byte-for-byte below): the FATAL
      CustomizationID gate that is what actually makes a document an SI-UBL 2.0 / NLCIUS invoice
      rather than a bare EN 16931 UBL one — `[SI-V20-INV-R000]` requires
      `starts-with(cbc:CustomizationID, 'urn:cen.eu:en16931:2017#compliant#urn:fdc:nen.nl:nlcius:v1.0')`.
      READ VERBATIM, never guessed (the mandant's own instruction) — the value the task prompt's own
      candidate guess (`...#compliant#urn:fdc:nen.nl:gaccount:v1.0`) is, on inspection of THIS exact
      rule and of the sibling `si-ubl-2.0/si-ubl-2.0-nlcius.sch` pattern below, the id of a SEPARATE,
      OPTIONAL "g-account" extension profile (`schematron/si-ubl-2.0-ext-gaccount.sch`, Dutch
      temporary-employment-agency reserve-account invoicing — `#conformant#`, not `#compliant#`, and
      never asserted as a REQUIRED alternative anywhere in either vendored file) — never the plain
      NLCIUS profile this provider builds. `../nlcius-provider.ts`'s own `NLCIUS_CUSTOMIZATION_ID`
      constant is this exact string, and nothing else.
   2. `schematron/si-ubl-2.0/si-ubl-2.0-nlcius.sch` in full (the file `si-ubl-2.0.sch` itself
      `<include>`s last) — copied byte-for-byte below, including its own top-of-file source comment
      (STPE's "gebruiksinstructie basisfactuur" PDF, pages 87+). BR-NL-1 through BR-NL-35 (several
      ids reused across sibling contexts — e.g. three separate `BR-NL-32-*` rules — exactly as the
      origin file itself declares; NOT a vendoring transcription error). BR-NL-1/BR-NL-10 are the
      ones this task's own mandate names directly: a Dutch supplier's (respectively, a Dutch
      customer's) legal entity identifier MUST carry ISO 6523 schemeID `0106` (KVK) or `0190` (OIN) —
      `../semantic/build-semantic-invoice.ts`'s own `LEGAL_ID_SCHEME_BY_COUNTRY` map is what makes
      this repo's OWN NL seller/buyer identifiers actually carry that schemeID (see that file's own
      header for the full reasoning, including the PRE-EXISTING gap this closes for the GENERIC
      Peppol BIS delta's own identical `NL-R-003`/`NL-R-005` rules, `../peppol/
      PEPPOL-EN16931-UBL.sch:880-894` — `country-identifiers/data/nl.json`'s own note already flagged
      this exact cross-reference before this task existed).

  XPST0017 CHECK (`../validate-schematron.ts`'s own header, "the lesson"): grepped for `xsl:function`
  in BOTH files above, and in every one of `si-ubl-2.0.sch`'s five bundled base `<include>`s
  (`si-ubl-2.0/CenPC434/**/*.sch`, fetched and grepped even though NOT vendored here, precisely to
  rule this out) — ZERO matches anywhere. Unlike `PEPPOL-EN16931-UBL.sch`'s twelve `u:*` functions,
  neither NLCIUS-specific pattern below declares, or calls, a single custom XPath function — nothing
  to register in `../validate-schematron.ts` for this delta.

  No `<let>` hoisting was needed (contrast `../de/XRechnung-UBL-validation-preprocessed.sch`'s own
  header, which DID need one): every `<let>` below (the "SI-UBL-VERSION" pattern declares none; the
  "nlcius" pattern declares nine, `$customizationID` through `$s`) is read ONLY by `<rule>`s inside
  that SAME `<pattern>` — the cross-pattern reference that forced XRechnung's `common.sch` variables
  to be promoted to schema-global scope never arises here, so both patterns are inlined completely
  unchanged, down to their own internal comments.
-->
<schema xmlns="http://purl.oclc.org/dsdl/schematron"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:ubl="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cn="urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2"
  queryBinding="xslt2">
  <title>SI-UBL 2.0 / NLCIUS validation, version 2.0.3.12 — NLCIUS delta (CustomizationID gate + BR-NL-1..35), vendored to run on top of this repo's own base EN 16931 UBL Schematron</title>
  <ns prefix="cbc" uri="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"/>
  <ns prefix="cac" uri="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"/>
  <ns prefix="ubl" uri="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"/>
  <ns prefix="cn" uri="urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2"/>
  <ns prefix="xs" uri="http://www.w3.org/2001/XMLSchema"/>

  <!-- ============================================================================================
       1. schematron/si-ubl-2.0.sch, pattern id="SI-UBL-VERSION" — copied byte-for-byte.
       ============================================================================================ -->
  <pattern xmlns="http://purl.oclc.org/dsdl/schematron" id="SI-UBL-VERSION">
      <rule context="ubl:Invoice" flag="fatal">
          <assert test="cbc:CustomizationID" flag="fatal">[BII2-T10-R001] An invoice MUST have a customization identifier</assert>
      </rule>
      <rule context="cn:CreditNote" flag="fatal">
          <assert test="cbc:CustomizationID" flag="fatal">[BII2-T10-R001] A credit note MUST have a customization identifier</assert>
      </rule>
      <!-- must be si 2.0 -->
      <rule context="cbc:CustomizationID">
          <assert test="starts-with(normalize-space(.), 'urn:cen.eu:en16931:2017#compliant#urn:fdc:nen.nl:nlcius:v1.0')" flag="fatal">[SI-V20-INV-R000]-This XML instance is NOT tagged as an SI-UBL 2.0 invoice or credit note; please check the CustomizationID value</assert>
      </rule>
      <rule context="/" flag="fatal">
          <assert test="ubl:Invoice or cn:CreditNote" flag="fatal">[SI-INV-R000]-This is not an SI-UBL 2.0 Invoice or CreditNote, validation cannot continue</assert>
      </rule>
  </pattern>

  <!-- ============================================================================================
       2. schematron/si-ubl-2.0/si-ubl-2.0-nlcius.sch, in full — copied byte-for-byte, including its
          own top-of-file source comment.
       ============================================================================================ -->
  <!--
       These rules are based on the specification in
       https://stpe.nl/media/stpe.nl-gebruiksinstructie-basisfactuur-v1.0.pdf
       (pages 87 and on)
  -->
  <pattern xmlns="http://purl.oclc.org/dsdl/schematron" abstract="false" id="nlcius">
    <!-- A few definitions to make later statements more readable -->
    <!-- These rules are generally only for SI-UBL 2.0 / NLCIUS -->
    <let name="customizationID" value="normalize-space(/*/cbc:CustomizationID)" />
    <let name="is_SI-UBL-2.0" value="contains($customizationID, '#compliant#urn:fdc:nen.nl:nlcius:v1.0')" />
    <let name="is_SI-UBL-2.0-ext-gaccount" value="contains($customizationID, '#conformant#urn:fdc:nen.nl:gaccount:v1.0')" />
    <!-- A number of rules only apply when the supplier is in the Netherlands -->
    <let name="supplierCountry" value="if (/*/cac:AccountingSupplierParty/cac:Party/cac:PostalAddress/cac:Country/cbc:IdentificationCode) then upper-case(normalize-space(/*/cac:AccountingSupplierParty/cac:Party/cac:PostalAddress/cac:Country/cbc:IdentificationCode)) else 'XX'" />
    <let name="supplierIsNL" value="$supplierCountry = 'NL'" />

    <!-- We generally divide these rules into two cases, depending on
         whether the supplier is from the Netherlands.
         Since all rules fall under one of these two, we make two general
         context shortcuts:
         1. '$si' for any supplier
         2. '$s' for suppliers in the netherlands
    -->
    <let name="si" value="($is_SI-UBL-2.0 or $is_SI-UBL-2.0-ext-gaccount)" />
    <let name="s" value="$supplierIsNL and ($is_SI-UBL-2.0 or $is_SI-UBL-2.0-ext-gaccount)" />

    <rule context="cac:AccountingSupplierParty/cac:Party[$s]">
      <assert id="BR-NL-1" test="(contains(concat(' ', string-join(cac:PartyLegalEntity/cbc:CompanyID/@schemeID, ' '), ' '), ' 0106 ') or contains(concat(' ', string-join(cac:PartyLegalEntity/cbc:CompanyID/@schemeID, ' '), ' '), ' 0190 ')) and (cac:PartyLegalEntity/cbc:CompanyID/normalize-space(.) != '')" flag="fatal">[BR-NL-1] For suppliers in the Netherlands the supplier MUST provide either a KVK or OIN number for its legal entity identifier (cac:AccountingSupplierParty/cac:Party/cac:PartyLegalEntity/cbc:CompanyID with schemeID 0106 or 0190)</assert>
    </rule>
    <rule context="/*[$s]">
      <assert id="BR-NL-2" test="(cbc:BuyerReference) or (cac:OrderReference/cbc:ID)" flag="fatal">[BR-NL-2] For suppliers in the Netherlands, the invoice MUST contain either the buyer reference (cbc:BuyerReference) or the order reference (cac:OrderReference/cbc:ID)</assert>
    </rule>
    <rule context="cac:AccountingSupplierParty/cac:Party/cac:PostalAddress[$s]">
      <assert id="BR-NL-3" test="cbc:StreetName and
                      cbc:CityName and
                      cbc:PostalZone" flag="fatal">[BR-NL-3] For suppliers in the Netherlands the supplier's address (cac:AccountingSupplierParty/cac:Party/cac:PostalAddress) MUST contain street name (cbc:StreetName), city (cbc:CityName) and postal zone (cbc:PostalZone)</assert>
    </rule>
    <rule context="cac:AccountingCustomerParty/cac:Party/cac:PostalAddress[$s]">
      <assert id="BR-NL-4" test="cac:Country/cbc:IdentificationCode != 'NL' or (
                      cbc:StreetName and
                      cbc:CityName and
                      cbc:PostalZone)" flag="fatal">[BR-NL-4] For suppliers in the Netherlands, if the customer is in the Netherlands, the customer address (cac:AccountingCustomerParty/cac:Party/cac:PostalAddress) MUST contain the street name (cbc:StreetName), the city (cbc:CityName) and the postal zone (cbc:PostalZone)</assert>
    </rule>
    <rule context="cac:TaxRepresentativeParty/cac:PostalAddress[$s]">
      <assert id="BR-NL-5" test="(cac:Country/cbc:IdentificationCode != 'NL') or
                      (cbc:StreetName and
                       cbc:CityName and
                       cbc:PostalZone)" flag="fatal">[BR-NL-5] For suppliers in the Netherlands, if the fiscal representative is in the Netherlands, the representative's address (cac:TaxRepresentativeParty/cac:PostalAddress) MUST contain street name (cbc:StreetName), city (cbc:CityName) and postal zone (cbc:PostalZone)</assert>
    </rule>
    <!-- BR-NL-6 is not specified; BR-NL-7 and BR-NL-8 are specified below -->
    <rule context="cbc:InvoiceTypeCode[$s]|cbc:CreditNoteTypeCode[$s]">
      <assert id="BR-NL-7" test=". = '380' or
                      . = '381' or
                      . = '384' or
                      . = '389'" flag="fatal">[BR-NL-7] The invoice or credit note type code (cbc:InvoiceTypeCode/cbc:CreditNoteTypeCode) MUST have one of the following values: 380, 381, 384, 389</assert>
      <assert id="BR-NL-8" test="(. != '381') or /cn:CreditNote"
                      flag="fatal">[BR-NL-8] If the invoice type code (cbc:InvoiceTypeCode) is 381, the document MUST use the CreditNote scheme</assert>
      <assert id="BR-NL-8" test="(. = '381') or /ubl:Invoice"
                      flag="fatal">[BR-NL-8] If the credit note type code (cbc:CreditNoteTypeCode) is 380, 384 or 389, the document MUST use the Invoice scheme</assert>
      <assert id="BR-NL-9" test="(. != '384') or
                      /*/cac:BillingReference/cac:InvoiceDocumentReference/cbc:ID" flag="fatal">[BR-NL-9] For suppliers in the Netherlands, if the document is a corrective invoice (cbc:InvoiceTypeCode = 384), the document MUST contain an invoice reference (cac:BillingReference/cac:InvoiceDocumentReference/cbc:ID)</assert>
    </rule>
    <rule context="cac:AccountingCustomerParty/cac:Party/cac:PartyLegalEntity[$s]">
      <assert id="BR-NL-10" test="
          (not(//cac:AccountingCustomerParty/cac:Party/cac:PostalAddress/cac:Country/cbc:IdentificationCode = 'NL')
           or
           contains(concat(' ', string-join(//cac:AccountingCustomerParty/cac:Party/cac:PartyLegalEntity/cbc:CompanyID/@schemeID, ' '), ' '), ' 0106 ')
           or
           contains(concat(' ', string-join(//cac:AccountingCustomerParty/cac:Party/cac:PartyLegalEntity/cbc:CompanyID/@schemeID, ' '), ' '), ' 0190 ')
          ) and (not(cbc:CompanyID) or (cbc:CompanyID/normalize-space(.) != ''))
      " flag="fatal">[BR-NL-10] For suppliers in the Netherlands, if the customer is in the Netherlands, the customer's legal entity identifier (cac:AccountingCustomerParty/cac:Party/cac:PartyLegalEntity/cbc:CompanyID) MUST be either a KVK (schemeID=0106) or OIN number (schemeID=0190)</assert>
    </rule>
    <rule context="/ubl:Invoice/cac:LegalMonetaryTotal[$s]">
      <assert id="BR-NL-11" test="xs:decimal(cbc:PayableAmount) &lt;= 0.0 or (//cac:PaymentMeans)" flag="fatal">[BR-NL-11] For suppliers in the Netherlands, the supplier MUST provide a means of payment (cac:PaymentMeans) if the payment is from customer to supplier</assert>
    </rule>
    <rule context="cac:PaymentMeans[$s]">
      <assert id="BR-NL-12" test="normalize-space(cbc:PaymentMeansCode) = '30' or
                normalize-space(cbc:PaymentMeansCode) = '48' or
                normalize-space(cbc:PaymentMeansCode) = '49' or
                normalize-space(cbc:PaymentMeansCode) = '57' or
                normalize-space(cbc:PaymentMeansCode) = '58' or
                normalize-space(cbc:PaymentMeansCode) = '59'" flag="fatal">[BR-NL-12] For suppliers in the Netherlands, the payment means code (cac:PaymentMeans/cbc:PaymentMeansCode) MUST be one of 30, 48, 49, 57, 58 or 59</assert>

      <!-- check if payment means code is 58 or 59 -->
      <assert id="BR-NL-31" test="not((normalize-space(cbc:PaymentMeansCode) = '58' or normalize-space(cbc:PaymentMeansCode) = '59')) or not(cac:PayeeFinancialAccount/cac:FinancialInstitutionBranch/cbc:ID)" flag="warning">[BR-NL-31] The use of a payment service provider identifier (cac:PaymentMeans/cac:PayeeFinancialAccount/cac:FinancialInstitutionBranch/cbc:ID) is not recommended for SEPA payments (cac:PaymentMeans/cbc:PaymentMeansCode = 58 or 59)</assert>
      <!-- should move BR-NL-32 to its own context too, then add BR-NL-34 there -->

    </rule>

    <!-- //Invoice/cac:OrderReference/cbc:ID -->
    <rule context="cac:OrderLineReference/cbc:LineID[$si]">
      <assert id="BR-NL-13" test="exists(/*/cac:OrderReference/cbc:ID)" flag="fatal">[BR-NL-13] If an order line reference (BT-132) is used, there must be an order reference on the document level (BT-13)</assert>
    </rule>


    <!--
         Recommendations specific for NL
         Invoices that fail these rules result in warnings, but should not be rejected
    -->
    <rule context="cbc:TaxCurrencyCode[$s]">
      <assert id="BR-NL-19" test="false" flag="warning">[BR-NL-19] The use of a tax currency code (cbc:TaxCurrencyCode) is not recommended</assert>
    </rule>
    <rule context="cbc:TaxPointDate[$s]">
      <assert id="BR-NL-20" test="false" flag="warning">[BR-NL-20] The use of a tax point date (cbc:TaxPointDate) is not recommended, and its value will be ignored</assert>
    </rule>
    <rule context="cac:InvoicePeriod/cbc:DescriptionCode[$s]">
      <assert id="BR-NL-21" test="false" flag="warning">[BR-NL-21] The use of a tax point date code (cac:InvoicePeriod/cbc:DescriptionCode) is not recommended, and its value will be ignored</assert>
    </rule>
    <!-- BR-NL-22 skipped, since there does not appear to be an equivalent for BT-21 in UBL 2.1 (cbc:Note is freeform) -->
    <!-- BR-NL-23 skipped, since a ProfileID is actually necessary for automatic lookups in the
         PEPPOL infrastructure -->
    <rule context="cac:BillingReference/cac:InvoiceDocumentReference/cbc:IssueDate[$s]">
      <assert id="BR-NL-24" test="false" flag="warning">[BR-NL-24] The use of a preceding invoice issue date (cac:BillingReference/cac:InvoiceDocumentReference/cbc:IssueDate) is not recommended</assert>
    </rule>
    <rule context="cac:AccountingSupplierParty/cac:Party/cac:PartyTaxScheme[$s]">
      <assert id="BR-NL-25" test="not(cbc:CompanyID) or cac:TaxScheme/cbc:ID = 'VAT'" flag="warning">[BR-NL-25] The use of a seller tax registration identifier (cac:AccountingSupplierParty/cac:Party/cac:PartyTaxScheme/cbc:CompanyID) is not recommended when the tax scheme is not VAT, since this is not applicable to suppliers in the Netherlands</assert>
    </rule>
    <rule context="cac:AccountingSupplierParty/cac:Party/cac:PartyLegalEntity/cbc:CompanyLegalForm[$s]">
      <assert id="BR-NL-26" test="false" flag="warning">[BR-NL-26] The use of the seller additional legal information field (cac:AccountingSupplierParty/cac:Party/cac:PartyLegalEntity/cbc:CompanyLegalForm) is not recommended, since this is not applicable for suppliers in the Netherlands</assert>
    </rule>
    <rule context="cac:AccountingSupplierParty/cac:Party/cac:PostalAddress/cac:AddressLine/cbc:Line[$s]">
      <assert id="BR-NL-27-1" test="false" flag="warning">[BR-NL-27] The use of the seller address line 3 (cac:AccountingSupplierParty/cac:Party/cac:PostalAddress/cac:AddressLine/cbc:Line) is not recommended</assert>
    </rule>
    <rule context="cac:AccountingCustomerParty/cac:Party/cac:PostalAddress/cac:AddressLine/cbc:Line[$s]">
      <assert id="BR-NL-27-2" test="false" flag="warning">[BR-NL-27] The use of the customer address line 3 (cac:AccountingCustomerParty/cac:Party/cac:PostalAddress/cac:AddressLine/cbc:Line) is not recommended</assert>
    </rule>
    <rule context="cac:TaxRepresentativeParty/cac:PostalAddress/cac:AddressLine/cbc:Line[$s]">
      <assert id="BR-NL-27-3" test="false" flag="warning">[BR-NL-27] The use of the tax representative address line 3 (cac:TaxRepresentativePart/cac:PostalAddress/cac:AddressLine/cbc:Line) is not recommended</assert>
    </rule>
    <rule context="cac:Delivery/cac:DeliveryLocation/cac:Address/cac:AddressLine/cbc:Line[$s]">
      <assert id="BR-NL-27-4" test="false" flag="warning">[BR-NL-27] The use of the delivery address line 3 (cac:Delivery/cac:DeliveryLocation/cac:Address/cac:AddressLine/cbc:Line) is not recommended</assert>
    </rule>
    <rule context="cac:AccountingSupplierParty/cac:Party/cac:PostalAddress/cbc:CountrySubentity[$s]">
      <assert id="BR-NL-28-1" test="false" flag="warning">[BR-NL-28] The use of a country subdivision (cac:AccountingSupplierParty/cac:Party/cac:PostalAddress/cbc:CountrySubentity) is not recommended</assert>
    </rule>
    <rule context="cac:AccountingCustomerParty/cac:Party/cac:PostalAddress/cbc:CountrySubentity[$s]">
      <assert id="BR-NL-28-2" test="false" flag="warning">[BR-NL-28] The use of a country subdivision (cac:AccountingCustomerParty/cac:Party/cac:PostalAddress/cbc:CountrySubentity) is not recommended</assert>
    </rule>
    <rule context="cac:TaxRepresentativeParty/cac:PostalAddress/cbc:CountrySubentity[$s]">
      <assert id="BR-NL-28-3" test="false" flag="warning">[BR-NL-28] The use of a country subdivision (cac:TaxRepresentativePart/cac:PostalAddress/cbc:CountrySubentity) is not recommended</assert>
    </rule>
    <rule context="cac:Delivery/cac:DeliveryLocation/cac:Address/cbc:CountrySubentity[$s]">
      <assert id="BR-NL-28-4" test="false" flag="warning">[BR-NL-28] The use of a country subdivision (cac:Delivery/cac:DeliveryLocation/cac:Address/cbc:CountrySubentity) is not recommended</assert>
    </rule>
    <rule context="cac:PaymentMeans/cbc:PaymentMeansCode[$s]">
      <assert id="BR-NL-29" test="not(@name)" flag="warning">[BR-NL-29] The use of a payment means text (cac:PaymentMeans/cbc:PaymentMeansCode/@name) is not recommended</assert>
    </rule>
    <rule context="cac:PaymentMeans/cac:PayeeFinancialAccount/cbc:Name[$s]">
      <assert id="BR-NL-30" test="false" flag="warning">[BR-NL-30] The use of a payment account name (cac:PaymentMeans/cac:PayeeFinancialAccount/cbc:Name) is not recommended</assert>
    </rule>
    <rule context="cac:AllowanceCharge/cbc:AllowanceChargeReasonCode[$s]">
      <assert id="BR-NL-32-1" test="false" flag="warning">[BR-NL-32] The use of an allowance reason code (cac:AllowanceCharge/cbc:AllowanceChargeReasonCode) is not recommended</assert>
    </rule>
    <rule context="cac:InvoiceLine/cac:AllowanceCharge/cbc:AllowanceChargeReasonCode[$s]">
      <assert id="BR-NL-32-2" test="false" flag="warning">[BR-NL-32] The use of an allowance reason code (cac:InvoiceLine/cac:AllowanceCharge/cbc:AllowanceChargeReasonCode) is not recommended</assert>
    </rule>
    <rule context="cac:CreditNoteLine/cac:AllowanceCharge/cbc:AllowanceChargeReasonCode[$s]">
      <assert id="BR-NL-32-3" test="false" flag="warning">[BR-NL-32] The use of an allowance reason code (cac:CreditNoteLine/cac:AllowanceCharge/cbc:AllowanceChargeReasonCode) is not recommended</assert>
      <!-- TODO: this test needs checking and testing -->
    </rule>
    <rule context="cac:TaxTotal/cbc:TaxAmount[$s]">
      <assert id="BR-NL-33" test="@currencyID = //cbc:DocumentCurrencyCode" flag="warning">[BR-NL-33] The use of a tax total in accounting currency (cac:TaxTotal/cbc:TaxAmount/@currencyID different than DocumentCurrencyCode) is not recommended</assert>
    </rule>
    <rule context="cac:AllowanceCharge/cbc:AllowanceChargeReasonCode[$s]">
      <assert id="BR-NL-32-1" test="false" flag="warning">[BR-NL-34] The use of a charge reason code (cac:AllowanceCharge/cbc:AllowanceChargeReasonCode) is not recommended</assert>
    </rule>
    <rule context="cac:InvoiceLine/cac:AllowanceCharge/cbc:AllowanceChargeReasonCode[$s]">
      <assert id="BR-NL-32-2" test="false" flag="warning">[BR-NL-34] The use of a charge reason code (cac:InvoiceLine/cac:AllowanceCharge/cbc:AllowanceChargeReasonCode) is not recommended</assert>
    </rule>
    <rule context="cac:CreditNoteLine/cac:AllowanceCharge/cbc:AllowanceChargeReasonCode[$s]">
      <assert id="BR-NL-32-3" test="false" flag="warning">[BR-NL-34] The use of a charge reason code (cac:CreditNoteLine/cac:AllowanceCharge/cbc:AllowanceChargeReasonCode) is not recommended</assert>
    </rule>
    <rule context="cac:TaxTotal/cac:TaxSubtotal/cac:TaxCategory/cbc:TaxExemptionReasonCode[$s]">
      <assert id="BR-NL-35" test="false" flag="warning">[BR-NL-35] The use of a tax exemption reason code (cac:TaxTotal/cac:TaxSubtotal/cac:TaxCategory/cbc:TaxExemptionReasonCode) is not recommended</assert>
    </rule>

    <rule context="//*[not(*) and not(normalize-space())]">
      <assert id="SI-UBL-2" test="false()" flag="warning">Document should not contain empty elements.</assert>
    </rule>

  </pattern>
</schema>
