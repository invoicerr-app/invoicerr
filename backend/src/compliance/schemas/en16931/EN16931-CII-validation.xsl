<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="2.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:svrl="http://purl.oclc.org/svl/svrl"
  xmlns:saxon="http://saxon.sf.net/"
  xmlns:ccts="urn:un:unece:uncefact:documentation:standard:CoreComponentsTechnicalSpecification:2"
  xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100"
  xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"
  xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"
  xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100"
  xmlns:xs="http://www.w3.org/2001/XMLSchema"
  exclude-result-prefixes="svrl saxon">

<xsl:template match="/">
  <svrl:schematron-output phase="#ALL" schemaVersion="">
    <svrl:title>EN16931-CII-validation</svrl:title>
    <xsl:apply-templates select="*" mode="svrl"/>
  </svrl:schematron-output>
</xsl:template>

<xsl:template match="text()" mode="svrl"/>
<xsl:template match="comment()" mode="svrl"/>
<xsl:template match="processing-instruction()" mode="svrl"/>
<xsl:template match="*" mode="svrl">
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:DesignatedProductClassification [EN16931-CII-Model] -->
<xsl:template match="ram:DesignatedProductClassification" mode="svrl" priority="101">
  <xsl:if test="not(normalize-space(ram:ClassCode/@listID) != '' or not (ram:ClassCode))">
    <svrl:failed-assert id="BR-65" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-65]-The Item classification identifier (BT-158) shall have a Scheme identifier.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:AdditionalReferencedDocument [EN16931-CII-Model] -->
<xsl:template match="ram:AdditionalReferencedDocument" mode="svrl" priority="102">
  <xsl:if test="not(normalize-space(ram:IssuerAssignedID) != '')">
    <svrl:failed-assert id="BR-52" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-52]-Each Additional supporting document (BG-24) shall contain a Supporting document reference (BT-122).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:ApplicableTradeSettlementFinancialCard [EN16931-CII-Model] -->
<xsl:template match="ram:ApplicableTradeSettlementFinancialCard" mode="svrl" priority="103">
  <xsl:if test="not(string-length(normalize-space(ram:ID)) <= 10)">
    <svrl:failed-assert id="BR-51" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-51]-In accordance with card payments security standards an invoice should never include a full card primary account number (BT-97). At the moment PCI Security Standards Council has defined that the first 6 digits and last 4 digits are the maximum number of digits to be shown.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:SpecifiedTradeSettlementPaymentMeans[ram:TypeCode='30' or ram:TypeCode='58']/ram:PayeePartyCreditorFinancialAccount [EN16931-CII-Model] -->
<xsl:template match="ram:SpecifiedTradeSettlementPaymentMeans[ram:TypeCode='30' or ram:TypeCode='58']/ram:PayeePartyCreditorFinancialAccount" mode="svrl" priority="104">
  <xsl:if test="not(normalize-space(ram:IBANID) != '' or normalize-space(ram:ProprietaryID) != '')">
    <svrl:failed-assert id="BR-50" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-50]-A Payment account identifier (BT-84) shall be present if Credit transfer (BG-16) information is provided in the Invoice.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not((ram:IBANID) or (ram:ProprietaryID))">
    <svrl:failed-assert id="BR-61" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-61]-If the Payment means type code (BT-81) means SEPA credit transfer, Local credit transfer or Non-SEPA international credit transfer, the Payment account identifier (BT-84) shall be present.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: /rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeDelivery [EN16931-CII-Model, EN16931-CII-Syntax] -->
<xsl:template match="/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeDelivery" mode="svrl" priority="105">
  <xsl:if test="not((ram:ShipToTradeParty/ram:PostalTradeAddress and normalize-space(ram:ShipToTradeParty/ram:PostalTradeAddress/ram:CountryID) != '') or not (ram:ShipToTradeParty/ram:PostalTradeAddress))">
    <svrl:failed-assert id="BR-57" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-57]-Each Deliver to address (BG-15) shall contain a Deliver to country code (BT-80).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:RelatedSupplyChainConsignment))">
    <svrl:failed-assert id="CII-SR-308" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-308] - RelatedSupplyChainConsignment should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ShipToTradeParty/ram:RoleCode))">
    <svrl:failed-assert id="CII-SR-309" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-309] - RoleCode should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ShipToTradeParty/ram:Description))">
    <svrl:failed-assert id="CII-SR-310" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-310] - Description should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ShipToTradeParty/ram:SpecifiedLegalOrganization))">
    <svrl:failed-assert id="CII-SR-311" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-311] - SpecifiedLegalOrganization should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ShipToTradeParty/ram:DefinedTradeContact))">
    <svrl:failed-assert id="CII-SR-312" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-312] - DefinedTradeContact should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ShipToTradeParty/ram:URIUniversalCommunication))">
    <svrl:failed-assert id="CII-SR-313" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-313] - URIUniversalCommunication should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ShipToTradeParty/ram:SpecifiedTaxRegistration))">
    <svrl:failed-assert id="CII-SR-314" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-314] - SpecifiedTaxRegistration should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ShipToTradeParty/ram:EndPointURIUniversalCommunication))">
    <svrl:failed-assert id="CII-SR-315" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-315] - EndPointURIUniversalCommunication should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ShipToTradeParty/ram:LogoAssociatedSpecifiedBinaryFile))">
    <svrl:failed-assert id="CII-SR-316" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-316] - LogoAssociatedSpecifiedBinaryFile should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:UltimateShipToTradeParty))">
    <svrl:failed-assert id="CII-SR-317" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-317] - UltimateShipToTradeParty should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ShipFromTradeParty))">
    <svrl:failed-assert id="CII-SR-318" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-318] - ShipFromTradeParty should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ActualDespatchSupplyChainEvent))">
    <svrl:failed-assert id="CII-SR-319" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-319] - ActualDespatchSupplyChainEvent should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ActualPickUpSupplyChainEvent))">
    <svrl:failed-assert id="CII-SR-320" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-320] - ActualPickUpSupplyChainEvent should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ActualDeliverySupplyChainEvent/ram:ID))">
    <svrl:failed-assert id="CII-SR-321" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-321] - ID should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ActualDeliverySupplyChainEvent/ram:OccurrenceDateTime/udt:DateTime))">
    <svrl:failed-assert id="CII-SR-322" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-322] - DateTime should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ActualDeliverySupplyChainEvent/ram:TypeCode))">
    <svrl:failed-assert id="CII-SR-323" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-323] - TypeCode should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ActualDeliverySupplyChainEvent/ram:Description))">
    <svrl:failed-assert id="CII-SR-324" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-324] - Description should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ActualDeliverySupplyChainEvent/ram:DescriptionBinaryObject))">
    <svrl:failed-assert id="CII-SR-325" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-325] - DescriptionBinaryObject should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ActualDeliverySupplyChainEvent/ram:UnitQuantity))">
    <svrl:failed-assert id="CII-SR-326" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-326] - UnitQuantity should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ActualDeliverySupplyChainEvent/ram:LatestOccurrenceDateTime))">
    <svrl:failed-assert id="CII-SR-327" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-327] - LatestOccurrenceDateTime should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ActualDeliverySupplyChainEvent/ram:EarliestOccurrenceDateTime))">
    <svrl:failed-assert id="CII-SR-328" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-328] - EarliestOccurrenceDateTime should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ActualDeliverySupplyChainEvent/ram:OccurrenceSpecifiedPeriod))">
    <svrl:failed-assert id="CII-SR-329" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-329] - OccurrenceSpecifiedPeriod should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ActualDeliverySupplyChainEvent/ram:OccurrenceLogisticsLocation))">
    <svrl:failed-assert id="CII-SR-330" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-330] - OccurrenceLogisticsLocation should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ActualReceiptSupplyChainEvent))">
    <svrl:failed-assert id="CII-SR-331" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-331] - ActualReceiptSupplyChainEvent should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:AdditionalReferencedDocument))">
    <svrl:failed-assert id="CII-SR-332" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-332] - AdditionalReferencedDocument should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:DespatchAdviceReferencedDocument/ram:LineID))">
    <svrl:failed-assert id="CII-SR-333" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-333] - LineID should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:DespatchAdviceReferencedDocument/ram:LineID))">
    <svrl:failed-assert id="CII-SR-334" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-334] - LineID should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:DeliveryNoteReferencedDocument))">
    <svrl:failed-assert id="CII-SR-335" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-335] - DeliveryNoteReferencedDocument should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ConsumptionReportReferencedDocument))">
    <svrl:failed-assert id="CII-SR-336" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-336] - ConsumptionReportReferencedDocument should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:PreviousDeliverySupplyChainEvent))">
    <svrl:failed-assert id="CII-SR-337" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-337] - PreviousDeliverySupplyChainEvent should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:PackingListReferencedDocument))">
    <svrl:failed-assert id="CII-SR-338" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-338] - PackingListReferencedDocument should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not((not(ram:ShipToTradeParty/ram:ID) and ram:ShipToTradeParty/ram:GlobalID) or (ram:ShipToTradeParty/ram:ID and not(ram:ShipToTradeParty/ram:GlobalID)) or (not(ram:ShipToTradeParty/ram:ID) and not(ram:ShipToTradeParty/ram:GlobalID)))">
    <svrl:failed-assert id="CII-SR-449" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-449] - Only one delivery to location identifier should be present (either the ID or the Global ID)</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeAllowanceCharge/ram:ChargeIndicator[udt:Indicator='false'] [EN16931-CII-Model] -->
<xsl:template match="ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeAllowanceCharge/ram:ChargeIndicator[udt:Indicator='false']" mode="svrl" priority="106">
  <xsl:if test="not((../ram:ActualAmount))">
    <svrl:failed-assert id="BR-31" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-31]-Each Document level allowance (BG-20) shall have a Document level allowance amount (BT-92).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not((../ram:CategoryTradeTax[upper-case(ram:TypeCode) = 'VAT']/ram:CategoryCode))">
    <svrl:failed-assert id="BR-32" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-32]-Each Document level allowance (BG-20) shall have a Document level allowance VAT category code (BT-95).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not((../ram:Reason) or (../ram:ReasonCode))">
    <svrl:failed-assert id="BR-33" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-33]-Each Document level allowance (BG-20) shall have a Document level allowance reason (BT-97) or a Document level allowance reason code (BT-98).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(true())">
    <svrl:failed-assert id="BR-CO-05" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-CO-05]-Document level allowance reason code (BT-98) and Document level allowance reason (BT-97) shall indicate the same type of allowance.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not((../ram:Reason) or (../ram:ReasonCode))">
    <svrl:failed-assert id="BR-CO-21" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-CO-21]-Each Document level allowance (BG-20) shall contain a Document level allowance reason (BT-97) or a Document level allowance reason code (BT-98), or both.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(string-length(substring-after(../ram:ActualAmount[1],'.'))<=2)">
    <svrl:failed-assert id="BR-DEC-01" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-DEC-01]-The allowed maximum number of decimals for the Document level allowance amount (BT-92) is 2.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(string-length(substring-after(../ram:BasisAmount,'.'))<=2)">
    <svrl:failed-assert id="BR-DEC-02" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-DEC-02]-The allowed maximum number of decimals for the Document level allowance base amount (BT-93) is 2.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeAllowanceCharge/ram:ChargeIndicator[udt:Indicator='true'] [EN16931-CII-Model] -->
<xsl:template match="ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeAllowanceCharge/ram:ChargeIndicator[udt:Indicator='true']" mode="svrl" priority="107">
  <xsl:if test="not((../ram:ActualAmount))">
    <svrl:failed-assert id="BR-36" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-36]-Each Document level charge (BG-21) shall have a Document level charge amount (BT-99).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not((../ram:CategoryTradeTax[upper-case(ram:TypeCode) = 'VAT']/ram:CategoryCode))">
    <svrl:failed-assert id="BR-37" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-37]-Each Document level charge (BG-21) shall have a Document level charge VAT category code (BT-102).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not((../ram:Reason) or (../ram:ReasonCode))">
    <svrl:failed-assert id="BR-38" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-38]-Each Document level charge (BG-21) shall have a Document level charge reason (BT-104) or a Document level charge reason code (BT-105).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(true())">
    <svrl:failed-assert id="BR-CO-06" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-CO-06]-Document level charge reason code (BT-105) and Document level charge reason (BT-104) shall indicate the same type of charge.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not((../ram:Reason) or (../ram:ReasonCode))">
    <svrl:failed-assert id="BR-CO-22" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-CO-22]-Each Document level charge (BG-21) shall contain a Document level charge reason (BT-104) or a Document level charge reason code (BT-105), or both.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(string-length(substring-after(../ram:ActualAmount[1],'.'))<=2)">
    <svrl:failed-assert id="BR-DEC-05" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-DEC-05]-The allowed maximum number of decimals for the Document level charge amount (BT-99) is 2.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(string-length(substring-after(../ram:BasisAmount,'.'))<=2)">
    <svrl:failed-assert id="BR-DEC-06" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-DEC-06]-The allowed maximum number of decimals for the Document level charge base amount (BT-100) is 2.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:SpecifiedTradeSettlementHeaderMonetarySummation [EN16931-CII-Model] -->
<xsl:template match="ram:SpecifiedTradeSettlementHeaderMonetarySummation" mode="svrl" priority="108">
  <xsl:if test="not((ram:LineTotalAmount))">
    <svrl:failed-assert id="BR-12" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-12]-An Invoice shall have the Sum of Invoice line net amount (BT-106).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not((ram:TaxBasisTotalAmount))">
    <svrl:failed-assert id="BR-13" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-13]-An Invoice shall have the Invoice total amount without VAT (BT-109).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not((ram:GrandTotalAmount))">
    <svrl:failed-assert id="BR-14" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-14]-An Invoice shall have the Invoice total amount with VAT (BT-112).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not((ram:DuePayableAmount))">
    <svrl:failed-assert id="BR-15" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-15]-An Invoice shall have the Amount due for payment (BT-115).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:TaxCurrencyCode) or (/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:TaxCurrencyCode and (ram:TaxTotalAmount/@currencyID = /rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:TaxCurrencyCode) and not(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:TaxCurrencyCode = /rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:InvoiceCurrencyCode)))">
    <svrl:failed-assert id="BR-53" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-53]-If the VAT accounting currency code (BT-6) is present, then the Invoice total VAT amount in accounting currency (BT-111) shall be provided.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(xs:decimal(ram:LineTotalAmount) = round(xs:decimal(sum(../../ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeSettlement/ram:SpecifiedTradeSettlementLineMonetarySummation/ram:LineTotalAmount)) * xs:decimal(100)) div xs:decimal(100))">
    <svrl:failed-assert id="BR-CO-10" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-CO-10]-Sum of Invoice line net amount (BT-106) = Σ Invoice line net amount (BT-131).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not((not(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator=false()])and not (ram:AllowanceTotalAmount)) or ram:AllowanceTotalAmount = (round(sum(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator=false()]/ram:ActualAmount[1])* 10 * 10 ) div 100))">
    <svrl:failed-assert id="BR-CO-11" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-CO-11]-Sum of allowances on document level (BT-107) = Σ Document level allowance amount (BT-92).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not((not(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator=true()])and not (ram:ChargeTotalAmount)) or ram:ChargeTotalAmount = (round(sum(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator=true()]/ram:ActualAmount[1])* 10 * 10 ) div 100))">
    <svrl:failed-assert id="BR-CO-12" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-CO-12]-Sum of charges on document level (BT-108) = Σ Document level charge amount (BT-99).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not((xs:decimal(ram:TaxBasisTotalAmount[1]) = round((xs:decimal(ram:LineTotalAmount[1]) - xs:decimal(ram:AllowanceTotalAmount[1]) + xs:decimal(ram:ChargeTotalAmount[1])) * 10 * 10) div 100)     or ((xs:decimal(ram:TaxBasisTotalAmount[1]) = round((xs:decimal(ram:LineTotalAmount[1]) - xs:decimal(ram:AllowanceTotalAmount[1])) * 10 * 10) div 100) and not(ram:ChargeTotalAmount))     or ((xs:decimal(ram:TaxBasisTotalAmount[1]) = round((xs:decimal(ram:LineTotalAmount[1]) + xs:decimal(ram:ChargeTotalAmount[1])) * 10 * 10) div 100) and not(ram:AllowanceTotalAmount))     or ((xs:decimal(ram:TaxBasisTotalAmount[1]) = round((xs:decimal(ram:LineTotalAmount[1])) * 10 * 10) div 100) and not(ram:ChargeTotalAmount) and not(ram:AllowanceTotalAmount)))">
    <svrl:failed-assert id="BR-CO-13" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-CO-13]-Invoice total amount without VAT (BT-109) = Σ Invoice line net amount (BT-131) - Sum of allowances on document level (BT-107) + Sum of charges on document level (BT-108).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not((xs:decimal(ram:DuePayableAmount[1]) = xs:decimal(ram:GrandTotalAmount[1]) - xs:decimal(ram:TotalPrepaidAmount[1]) + xs:decimal(ram:RoundingAmount[1]))     or ((xs:decimal(ram:DuePayableAmount[1]) = xs:decimal(ram:GrandTotalAmount[1]) + xs:decimal(ram:RoundingAmount[1])) and not(ram:TotalPrepaidAmount))     or ((xs:decimal(ram:DuePayableAmount[1]) = xs:decimal(ram:GrandTotalAmount[1]) - xs:decimal(ram:TotalPrepaidAmount[1])) and not(ram:RoundingAmount))     or ((xs:decimal(ram:DuePayableAmount[1]) = xs:decimal(ram:GrandTotalAmount[1])) and not(ram:TotalPrepaidAmount) and not(ram:RoundingAmount)))">
    <svrl:failed-assert id="BR-CO-16" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-CO-16]-Amount due for payment (BT-115) = Invoice total amount with VAT (BT-112) -Paid amount (BT-113) +Rounding amount (BT-114).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(string-length(substring-after(ram:LineTotalAmount,'.'))<=2)">
    <svrl:failed-assert id="BR-DEC-09" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-DEC-09]-The allowed maximum number of decimals for the Sum of Invoice line net amount (BT-106) is 2.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(string-length(substring-after(ram:AllowanceTotalAmount,'.'))<=2)">
    <svrl:failed-assert id="BR-DEC-10" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-DEC-10]-The allowed maximum number of decimals for the Sum of allowanced on document level (BT-107) is 2.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(string-length(substring-after(ram:ChargeTotalAmount,'.'))<=2)">
    <svrl:failed-assert id="BR-DEC-11" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-DEC-11]-The allowed maximum number of decimals for the Sum of charges on document level (BT-108) is 2.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(string-length(substring-after(ram:TaxBasisTotalAmount,'.'))<=2)">
    <svrl:failed-assert id="BR-DEC-12" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-DEC-12]-The allowed maximum number of decimals for the Invoice total amount without VAT (BT-109) is 2.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(string-length(substring-after(ram:GrandTotalAmount,'.'))<=2)">
    <svrl:failed-assert id="BR-DEC-14" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-DEC-14]-The allowed maximum number of decimals for the Invoice total amount with VAT (BT-112) is 2.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:TaxTotalAmount) or ram:TaxTotalAmount[(@currencyID =/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:InvoiceCurrencyCode and . = round(. * 100) div 100) or not (@currencyID =/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:InvoiceCurrencyCode)])">
    <svrl:failed-assert id="BR-DEC-13" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-DEC-13]-The allowed maximum number of decimals for the Invoice total VAT amount (BT-110) is 2.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:TaxTotalAmount) or ram:TaxTotalAmount[(@currencyID =/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:TaxCurrencyCode and . = round(. * 100) div 100) or not (/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:TaxCurrencyCode)])">
    <svrl:failed-assert id="BR-DEC-15" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-DEC-15]-The allowed maximum number of decimals for the Invoice total VAT amount in accounting currency (BT-111) is 2.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(string-length(substring-after(ram:TotalPrepaidAmount,'.'))<=2)">
    <svrl:failed-assert id="BR-DEC-16" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-DEC-16]-The allowed maximum number of decimals for the Paid amount (BT-113) is 2.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(string-length(substring-after(ram:RoundingAmount,'.'))<=2)">
    <svrl:failed-assert id="BR-DEC-17" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-DEC-17]-The allowed maximum number of decimals for the Rounding amount (BT-114) is 2.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(string-length(substring-after(ram:DuePayableAmount,'.'))<=2)">
    <svrl:failed-assert id="BR-DEC-18" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-DEC-18]-The allowed maximum number of decimals for the Amount due for payment (BT-115) is 2.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: /rsm:CrossIndustryInvoice [EN16931-CII-Model, EN16931-CII-Syntax] -->
<xsl:template match="/rsm:CrossIndustryInvoice" mode="svrl" priority="109">
  <xsl:if test="not(normalize-space(rsm:ExchangedDocumentContext/ram:GuidelineSpecifiedDocumentContextParameter/ram:ID) != '')">
    <svrl:failed-assert id="BR-01" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-01]-An Invoice shall have a Specification identifier (BT-24).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(normalize-space(rsm:ExchangedDocument/ram:ID) != '')">
    <svrl:failed-assert id="BR-02" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-02]-An Invoice shall have an Invoice number (BT-1).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(normalize-space(rsm:ExchangedDocument/ram:IssueDateTime/udt:DateTimeString[@format='102']) != '')">
    <svrl:failed-assert id="BR-03" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-03]-An Invoice shall have an Invoice issue date (BT-2).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(normalize-space(rsm:ExchangedDocument/ram:TypeCode) != '')">
    <svrl:failed-assert id="BR-04" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-04]-An Invoice shall have an Invoice type code (BT-3).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(normalize-space(rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:InvoiceCurrencyCode) != '')">
    <svrl:failed-assert id="BR-05" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-05]-An Invoice shall have an Invoice currency code (BT-5).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(normalize-space(rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SellerTradeParty/ram:Name) != '')">
    <svrl:failed-assert id="BR-06" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-06]-An Invoice shall contain the Seller name (BT-27).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(normalize-space(rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:BuyerTradeParty/ram:Name) != '')">
    <svrl:failed-assert id="BR-07" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-07]-An Invoice shall contain the Buyer name (BT-44).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SellerTradeParty/ram:PostalTradeAddress)">
    <svrl:failed-assert id="BR-08" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-08]-An Invoice shall contain the Seller postal address (BG-5).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(normalize-space(rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SellerTradeParty/ram:PostalTradeAddress/ram:CountryID) != '')">
    <svrl:failed-assert id="BR-09" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-09]-The Seller postal address (BG-5) shall contain a Seller country code (BT-40).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:BuyerTradeParty/ram:PostalTradeAddress)">
    <svrl:failed-assert id="BR-10" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-10]-An Invoice shall contain the Buyer postal address (BG-8).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(normalize-space(rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:BuyerTradeParty/ram:PostalTradeAddress/ram:CountryID) != '')">
    <svrl:failed-assert id="BR-11" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-11]-The Buyer postal address shall contain a Buyer country code (BT-55).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(//ram:IncludedSupplyChainTradeLineItem)">
    <svrl:failed-assert id="BR-16" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-16]-An Invoice shall have at least one Invoice line (BG-25).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(normalize-space(rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SellerTradeParty/ram:URIUniversalCommunication[1]/ram:URIID/@schemeID) != '' or not (rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SellerTradeParty/ram:URIUniversalCommunication))">
    <svrl:failed-assert id="BR-62" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-62]-The Seller electronic address (BT-34) shall have a Scheme identifier.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(normalize-space(rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:BuyerTradeParty/ram:URIUniversalCommunication[1]/ram:URIID/@schemeID) != '' or not (rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:BuyerTradeParty/ram:URIUniversalCommunication))">
    <svrl:failed-assert id="BR-63" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-63]-The Buyer electronic address (BT-49) shall have a Scheme identifier.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(every $Currency in /rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:InvoiceCurrencyCode     satisfies     (     (     count(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeSettlementHeaderMonetarySummation/ram:TaxTotalAmount[@currencyID = $Currency]) = 1     and     xs:decimal((/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeSettlementHeaderMonetarySummation/ram:GrandTotalAmount)[1])     =     round(     (     xs:decimal((/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeSettlementHeaderMonetarySummation/ram:TaxBasisTotalAmount)[1])     +     xs:decimal((/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeSettlementHeaderMonetarySummation/ram:TaxTotalAmount[@currencyID = $Currency])[1])     ) * 100     ) div 100     )     or     (     xs:decimal((/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeSettlementHeaderMonetarySummation/ram:GrandTotalAmount)[1])     =     xs:decimal((/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeSettlementHeaderMonetarySummation/ram:TaxBasisTotalAmount)[1])     )     ))">
    <svrl:failed-assert id="BR-CO-15" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-CO-15]-Invoice total amount with VAT (BT-112) = Invoice total amount without VAT (BT-109) + Invoice total VAT amount (BT-110).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(((count(//ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax[ram:CategoryCode='S']) + count(//ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax[ram:CategoryCode='S'])) >=2 or not (//ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax[ram:CategoryCode='S'])) and      ((count(//ram:CategoryTradeTax[ram:CategoryCode='S']) + count(//ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax[ram:CategoryCode='S'])) >=2 or not (//ram:CategoryTradeTax[ram:CategoryCode='S'])))">
    <svrl:failed-assert id="BR-S-01" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-S-01]-An Invoice that contains an Invoice line (BG-25), a Document level allowance (BG-20) or a Document level charge (BG-21) where the VAT category code (BT-151, BT-95 or BT-102) is "Standard rated" shall contain in the VAT breakdown (BG-23) at least one VAT category code (BT-118) equal with "Standard rated".</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not((count(//ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax[ram:CategoryCode='Z'])=0 and count(//ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax[ram:CategoryCode='Z'])=0 and count(//ram:CategoryTradeTax[ram:CategoryCode='Z'])=0) or ( count(//ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax[ram:CategoryCode='Z'])=1 and (exists(//ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax[ram:CategoryCode='Z']) or exists(//ram:CategoryTradeTax[ram:CategoryCode='Z']))))">
    <svrl:failed-assert id="BR-Z-01" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-Z-01]-An Invoice that contains an Invoice line (BG-25), a Document level allowance (BG-20) or a Document level charge (BG-21) where the VAT category code (BT-151, BT-95 or BT-102) is "Zero rated" shall contain in the VAT breakdown (BG-23) exactly one VAT category code (BT-118) equal with "Zero rated".</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not((count(//ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax[ram:CategoryCode='E'])=0 and count(//ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax[ram:CategoryCode='E'])=0 and count(//ram:CategoryTradeTax[ram:CategoryCode='E'])=0) or ( count(//ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax[ram:CategoryCode='E'])=1 and (exists(//ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax[ram:CategoryCode='E']) or exists(//ram:CategoryTradeTax[ram:CategoryCode='E']))))">
    <svrl:failed-assert id="BR-E-01" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-E-01]-An Invoice that contains an Invoice line (BG-25), a Document level allowance (BG-20) or a Document level charge (BG-21) where the VAT category code (BT-151, BT-95 or BT-102) is "Exempt from VAT" shall contain exactly one VAT breakdown (BG-23) with the VAT category code (BT-118) equal to "Exempt from VAT".</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not((count(//ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax[ram:CategoryCode='AE'])=0 and count(//ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax[ram:CategoryCode='AE'])=0 and count(//ram:CategoryTradeTax[ram:CategoryCode='AE'])=0) or ( count(//ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax[ram:CategoryCode='AE'])=1 and (exists(//ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax[ram:CategoryCode='AE']) or exists(//ram:CategoryTradeTax[ram:CategoryCode='AE']))))">
    <svrl:failed-assert id="BR-AE-01" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-AE-01]-An Invoice that contains an Invoice line (BG-25), a Document level allowance (BG-20) or a Document level charge (BG-21) where the VAT category code (BT-151, BT-95 or BT-102) is "Reverse charge" shall contain in the VAT breakdown (BG-23) exactly one VAT category code (BT-118) equal with "VAT reverse charge".</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not((count(//ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax[ram:CategoryCode='K'])=0 and count(//ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax[ram:CategoryCode='K'])=0 and count(//ram:CategoryTradeTax[ram:CategoryCode='K'])=0) or ( count(//ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax[ram:CategoryCode='K'])=1 and (exists(//ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax[ram:CategoryCode='K']) or exists(//ram:CategoryTradeTax[ram:CategoryCode='K']))))">
    <svrl:failed-assert id="BR-IC-01" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-IC-01]-An Invoice that contains an Invoice line (BG-25), a Document level allowance (BG-20) or a Document level charge (BG-21) where the VAT category code (BT-151, BT-95 or BT-102) is "Intra-community supply" shall contain in the VAT breakdown (BG-23) exactly one VAT category code (BT-118) equal with "Intra-community supply".</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not((count(//ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax[ram:CategoryCode='G'])=0 and count(//ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax[ram:CategoryCode='G'])=0 and count(//ram:CategoryTradeTax[ram:CategoryCode='G'])=0) or ( count(//ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax[ram:CategoryCode='G'])=1 and (exists(//ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax[ram:CategoryCode='G']) or exists(//ram:CategoryTradeTax[ram:CategoryCode='G']))))">
    <svrl:failed-assert id="BR-G-01" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-G-01]-An Invoice that contains an Invoice line (BG-25), a Document level allowance (BG-20) or a Document level charge (BG-21) where the VAT category code (BT-151, BT-95 or BT-102) is "Export outside the EU" shall contain in the VAT breakdown (BG-23) exactly one VAT category code (BT-118) equal with "Export outside the EU".</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(//ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax[ram:CategoryCode='O']) or (      count(//ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax[ram:CategoryCode='O'])=1 and      (exists(//ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax[ram:CategoryCode='O']) or     exists(//ram:CategoryTradeTax[ram:CategoryCode='O']))))">
    <svrl:failed-assert id="BR-O-01" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-O-01]-An Invoice that contains an Invoice line (BG-25), a Document level allowance (BG-20) or a Document level charge (BG-21) where the VAT category code (BT-151, BT-95 or BT-102) is "Not subject to VAT" shall contain exactly one VAT breakdown group (BG-23) with the VAT category code (BT-118) equal to "Not subject to VAT".</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(((count(//ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax[ram:CategoryCode='L']) + count(//ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax[ram:CategoryCode='L'])) >=2 or not (//ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax[ram:CategoryCode='L'])) and      ((count(//ram:CategoryTradeTax[ram:CategoryCode='L']) + count(//ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax[ram:CategoryCode='L'])) >=2 or not (//ram:CategoryTradeTax[ram:CategoryCode='L'])))">
    <svrl:failed-assert id="BR-AF-01" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-AF-01]-An Invoice that contains an Invoice line (BG-25), a Document level allowance (BG-20) or a Document level charge (BG-21) where the VAT category code (BT-151, BT-95 or BT-102) is "IGIC" shall contain in the VAT breakdown (BG-23) at least one VAT category code (BT-118) equal with "IGIC".</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(((count(//ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax[ram:CategoryCode='M']) + count(//ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax[ram:CategoryCode='M'])) >=2 or not (//ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax[ram:CategoryCode='M'])) and      ((count(//ram:CategoryTradeTax[ram:CategoryCode='M']) + count(//ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax[ram:CategoryCode='M'])) >=2 or not (//ram:CategoryTradeTax[ram:CategoryCode='M'])))">
    <svrl:failed-assert id="BR-AG-01" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-AG-01]-An Invoice that contains an Invoice line (BG-25), a Document level allowance (BG-20) or a Document level charge (BG-21) where the VAT category code (BT-151, BT-95 or BT-102) is "IPSI" shall contain in the VAT breakdown (BG-23) at least one VAT category code (BT-118) equal with "IPSI".</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not((not(//ram:CountryID != 'IT') and //ram:CategoryCode ='B') or (not(//ram:CategoryCode ='B')))">
    <svrl:failed-assert id="BR-B-01" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-B-01]-An Invoice where the VAT category code (BT-151, BT-95 or BT-102) is “Split payment” shall be a domestic Italian invoice.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not((//ram:CategoryCode ='B' and (not(//ram:CategoryCode ='S'))) or (not(//ram:CategoryCode ='B')))">
    <svrl:failed-assert id="BR-B-02" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-B-02]-An Invoice that contains an Invoice line (BG-25), a Document level allowance (BG-20) or a Document level charge (BG-21) where the VAT category code (BT-151, BT-95 or BT-102) is “Split payment" shall not contain an invoice line (BG-25), a Document level allowance (BG-20) or  a Document level charge (BG-21) where the VAT category code (BT-151, BT-95 or BT-102) is “Standard rated”.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(@languageID))">
    <svrl:failed-assert id="CII-DT-013" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-013] - languageID should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(@languageLocaleID))">
    <svrl:failed-assert id="CII-DT-014" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-014] - languageLocaleID should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ValuationBreakdownStatement))">
    <svrl:failed-assert id="CII-SR-438" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-438] - ValuationBreakdownStatement should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(count(//ram:SpecifiedTradeSettlementPaymentMeans/ram:TypeCode[normalize-space(.) != normalize-space((//ram:SpecifiedTradeSettlementPaymentMeans/ram:TypeCode)[1])]) = 0)">
    <svrl:failed-assert id="CII-SR-467" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-SR-467] - All Payment means type codes (BT-81) shall have the same value across all SpecifiedTradeSettlementPaymentMeans.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(count(//ram:SpecifiedTradeSettlementPaymentMeans/ram:Information[normalize-space(.) != normalize-space((//ram:SpecifiedTradeSettlementPaymentMeans/ram:Information)[1])]) = 0)">
    <svrl:failed-assert id="CII-SR-468" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-SR-468] - All Payment means texts (BT-82) shall have the same value across all SpecifiedTradeSettlementPaymentMeans.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(count(//ram:ApplicableHeaderTradeSettlement/ram:PaymentReference) <= 1)">
    <svrl:failed-assert id="CII-SR-469" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-SR-469] - Payment reference (BT-83) shall occur at most once in the document.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:IncludedSupplyChainTradeLineItem [EN16931-CII-Model] -->
<xsl:template match="ram:IncludedSupplyChainTradeLineItem" mode="svrl" priority="110">
  <xsl:if test="not(normalize-space(ram:AssociatedDocumentLineDocument/ram:LineID) != '')">
    <svrl:failed-assert id="BR-21" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-21]-Each Invoice line (BG-25) shall have an Invoice line identifier (BT-126).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not((ram:SpecifiedLineTradeDelivery/ram:BilledQuantity))">
    <svrl:failed-assert id="BR-22" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-22]-Each Invoice line (BG-25) shall have an Invoiced quantity (BT-129).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not((ram:SpecifiedLineTradeDelivery/ram:BilledQuantity/@unitCode))">
    <svrl:failed-assert id="BR-23" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-23]-An Invoice line (BG-25) shall have an Invoiced quantity unit of measure code (BT-130).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not((ram:SpecifiedLineTradeSettlement/ram:SpecifiedTradeSettlementLineMonetarySummation/ram:LineTotalAmount))">
    <svrl:failed-assert id="BR-24" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-24]-Each Invoice line (BG-25) shall have an Invoice line net amount (BT-131).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(normalize-space(ram:SpecifiedTradeProduct/ram:Name) != '')">
    <svrl:failed-assert id="BR-25" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-25]-Each Invoice line (BG-25) shall contain the Item name (BT-153).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not((ram:SpecifiedLineTradeAgreement/ram:NetPriceProductTradePrice/ram:ChargeAmount))">
    <svrl:failed-assert id="BR-26" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-26]-Each Invoice line (BG-25) shall contain the Item net price (BT-146).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not((ram:SpecifiedLineTradeAgreement/ram:NetPriceProductTradePrice/ram:ChargeAmount) >= 0)">
    <svrl:failed-assert id="BR-27" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-27]-The Item net price (BT-146) shall NOT be negative.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not((ram:SpecifiedLineTradeAgreement/ram:GrossPriceProductTradePrice/ram:ChargeAmount >= 0) or not(ram:SpecifiedLineTradeAgreement/ram:GrossPriceProductTradePrice/ram:ChargeAmount))">
    <svrl:failed-assert id="BR-28" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-28]-The Item gross price (BT-148) shall NOT be negative.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(normalize-space(ram:SpecifiedTradeProduct/ram:GlobalID/@schemeID) != '' or not (ram:SpecifiedTradeProduct/ram:GlobalID))">
    <svrl:failed-assert id="BR-64" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-64]-The Item standard identifier (BT-157) shall have a Scheme identifier.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not((ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax[upper-case(ram:TypeCode) = 'VAT']/ram:CategoryCode))">
    <svrl:failed-assert id="BR-CO-04" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-CO-04]-Each Invoice line (BG-25) shall be categorized with an Invoiced item VAT category code (BT-151).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(//rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax)">
    <svrl:failed-assert id="BR-CO-18" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-CO-18]-An Invoice shall at least have one VAT breakdown group (BG-23).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(string-length(substring-after(ram:SpecifiedLineTradeSettlement/ram:SpecifiedTradeSettlementLineMonetarySummation/ram:LineTotalAmount,'.'))<=2)">
    <svrl:failed-assert id="BR-DEC-23" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-DEC-23]-The allowed maximum number of decimals for the Invoice line net amount (BT-131) is 2.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:SpecifiedLineTradeSettlement/ram:SpecifiedTradeAllowanceCharge/ram:ChargeIndicator[udt:Indicator = 'false'] [EN16931-CII-Model] -->
<xsl:template match="ram:SpecifiedLineTradeSettlement/ram:SpecifiedTradeAllowanceCharge/ram:ChargeIndicator[udt:Indicator = 'false']" mode="svrl" priority="111">
  <xsl:if test="not((../ram:ActualAmount))">
    <svrl:failed-assert id="BR-41" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-41]-Each Invoice line allowance (BG-27) shall have an Invoice line allowance amount (BT-136).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not((../ram:Reason) or (../ram:ReasonCode))">
    <svrl:failed-assert id="BR-42" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-42]-Each Invoice line allowance (BG-27) shall have an Invoice line allowance reason (BT-139) or an Invoice line allowance reason code (BT-140).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(true())">
    <svrl:failed-assert id="BR-CO-07" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-CO-07]-Invoice line allowance reason code (BT-140) and Invoice line allowance reason (BT-139) shall indicate the same type of allowance reason.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not((../ram:Reason) or (../ram:ReasonCode))">
    <svrl:failed-assert id="BR-CO-23" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-CO-23]-Each Invoice line allowance (BG-27) shall contain an Invoice line allowance reason (BT-139) or an Invoice line allowance reason code (BT-140), or both.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(string-length(substring-after(../ram:ActualAmount[1],'.'))<=2)">
    <svrl:failed-assert id="BR-DEC-24" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-DEC-24]-The allowed maximum number of decimals for the Invoice line allowance amount (BT-136) is 2.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(string-length(substring-after(../ram:BasisAmount,'.'))<=2)">
    <svrl:failed-assert id="BR-DEC-25" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-DEC-25]-The allowed maximum number of decimals for the Invoice line allowance base amount (BT-137) is 2.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:SpecifiedLineTradeSettlement/ram:SpecifiedTradeAllowanceCharge/ram:ChargeIndicator[udt:Indicator = 'true'] [EN16931-CII-Model] -->
<xsl:template match="ram:SpecifiedLineTradeSettlement/ram:SpecifiedTradeAllowanceCharge/ram:ChargeIndicator[udt:Indicator = 'true']" mode="svrl" priority="112">
  <xsl:if test="not((../ram:ActualAmount))">
    <svrl:failed-assert id="BR-43" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-43]-Each Invoice line charge (BG-28) shall have an Invoice line charge amount (BT-141).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not((../ram:Reason) or (../ram:ReasonCode))">
    <svrl:failed-assert id="BR-44" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-44]-Each Invoice line charge (BG-28) shall have an Invoice line charge reason (BT-144) or an Invoice line charge reason code (BT-145).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(true())">
    <svrl:failed-assert id="BR-CO-08" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-CO-08]-Invoice line charge reason code (BT-145) and Invoice line charge reason (BT-144) shall indicate the same type of charge reason.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not((../ram:Reason) or (../ram:ReasonCode))">
    <svrl:failed-assert id="BR-CO-24" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-CO-24]-Each Invoice line charge (BG-28) shall contain an Invoice line charge reason (BT-144) or an Invoice line charge reason code (BT-145), or both.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(string-length(substring-after(../ram:ActualAmount[1],'.'))<=2)">
    <svrl:failed-assert id="BR-DEC-27" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-DEC-27]-The allowed maximum number of decimals for the Invoice line charge amount (BT-141) is 2.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(string-length(substring-after(../ram:BasisAmount,'.'))<=2)">
    <svrl:failed-assert id="BR-DEC-28" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-DEC-28]-The allowed maximum number of decimals for the Invoice line charge base amount (BT-142) is 2.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:SpecifiedLineTradeSettlement/ram:BillingSpecifiedPeriod [EN16931-CII-Model] -->
<xsl:template match="ram:SpecifiedLineTradeSettlement/ram:BillingSpecifiedPeriod" mode="svrl" priority="113">
  <xsl:if test="not((ram:EndDateTime/udt:DateTimeString[@format = '102']) >= (ram:StartDateTime/udt:DateTimeString[@format = '102']) or not (ram:EndDateTime) or not (ram:StartDateTime))">
    <svrl:failed-assert id="BR-30" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-30]-If both Invoice line period start date (BT-134) and Invoice line period end date (BT-135) are given then the Invoice line period end date (BT-135) shall be later or equal to the Invoice line period start date (BT-134).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not((ram:StartDateTime) or (ram:EndDateTime))">
    <svrl:failed-assert id="BR-CO-20" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-CO-20]-If Invoice line period (BG-26) is used, the Invoice line period start date (BT-134) or the Invoice line period end date (BT-135) shall be filled, or both.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:ApplicableHeaderTradeSettlement/ram:BillingSpecifiedPeriod [EN16931-CII-Model] -->
<xsl:template match="ram:ApplicableHeaderTradeSettlement/ram:BillingSpecifiedPeriod" mode="svrl" priority="114">
  <xsl:if test="not((ram:EndDateTime/udt:DateTimeString[@format = '102']) >= (ram:StartDateTime/udt:DateTimeString[@format = '102']) or not (ram:EndDateTime) or not (ram:StartDateTime))">
    <svrl:failed-assert id="BR-29" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-29]-If both Invoicing period start date (BT-73) and Invoicing period end date (BT-74) are given then the Invoicing period end date (BT-74) shall be later or equal to the Invoicing period start date (BT-73).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not((ram:StartDateTime) or (ram:EndDateTime))">
    <svrl:failed-assert id="BR-CO-19" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-CO-19]-If Invoicing period (BG-14) is used, the Invoicing period start date (BT-73) or the Invoicing period end date (BT-74) shall be filled, or both.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:ApplicableProductCharacteristic [EN16931-CII-Model] -->
<xsl:template match="ram:ApplicableProductCharacteristic" mode="svrl" priority="115">
  <xsl:if test="not((ram:Description) and (ram:Value))">
    <svrl:failed-assert id="BR-54" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-54]-Each Item attribute (BG-32) shall contain an Item attribute name (BT-160) and an Item attribute value (BT-161).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:PayeeTradeParty [EN16931-CII-Model] -->
<xsl:template match="ram:PayeeTradeParty" mode="svrl" priority="116">
  <xsl:if test="not((ram:Name) and (not(ram:Name = ../../ram:ApplicableHeaderTradeAgreement/ram:SellerTradeParty/ram:Name) and not(ram:ID = ../../ram:ApplicableHeaderTradeAgreement/ram:SellerTradeParty/ram:ID) and not(ram:SpecifiedLegalOrganization/ram:ID = ../../ram:ApplicableHeaderTradeAgreement/ram:SellerTradeParty/ram:SpecifiedLegalOrganization/ram:ID)))">
    <svrl:failed-assert id="BR-17" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-17]-The Payee name (BT-59) shall be provided in the Invoice, if the Payee (BG-10) is different from the Seller (BG-4).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:SpecifiedTradeSettlementPaymentMeans [EN16931-CII-Model, EN16931-CII-Syntax] -->
<xsl:template match="ram:SpecifiedTradeSettlementPaymentMeans" mode="svrl" priority="117">
  <xsl:if test="not((ram:TypeCode))">
    <svrl:failed-assert id="BR-49" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-49]-A Payment instruction (BG-16) shall specify the Payment means type code (BT-81).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:PayerSpecifiedDebtorFinancialInstitution))">
    <svrl:failed-assert id="CII-SR-464" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-464] - PayerSpecifiedDebtorFincancialInstitution shall not be used.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: /rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:InvoiceReferencedDocument [EN16931-CII-Model] -->
<xsl:template match="/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:InvoiceReferencedDocument" mode="svrl" priority="118">
  <xsl:if test="not(normalize-space(ram:IssuerAssignedID) != '')">
    <svrl:failed-assert id="BR-55" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-55]-Each Preceding Invoice reference (BG-3) shall contain a Preceding Invoice reference (BT-25).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:SellerTradeParty [EN16931-CII-Model] -->
<xsl:template match="ram:SellerTradeParty" mode="svrl" priority="119">
  <xsl:if test="not((ram:ID) or (ram:GlobalID) or (ram:SpecifiedLegalOrganization/ram:ID) or (ram:SpecifiedTaxRegistration/ram:ID[@schemeID='VA']))">
    <svrl:failed-assert id="BR-CO-26" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-CO-26]-In order for the buyer to automatically identify a supplier, the Seller identifier (BT-29), the Seller legal registration identifier (BT-30) and/or the Seller VAT identifier (BT-31) shall be present.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:SellerTaxRepresentativeTradeParty [EN16931-CII-Model] -->
<xsl:template match="ram:SellerTaxRepresentativeTradeParty" mode="svrl" priority="120">
  <xsl:if test="not(normalize-space(ram:Name) != '')">
    <svrl:failed-assert id="BR-18" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-18]-The Seller tax representative name (BT-62) shall be provided in the Invoice, if the Seller (BG-4) has a Seller tax representative party (BG-11).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not((ram:PostalTradeAddress))">
    <svrl:failed-assert id="BR-19" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-19]-The Seller tax representative postal address (BG-12) shall be provided in the Invoice, if the Seller (BG-4) has a Seller tax representative party (BG-11).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(normalize-space(ram:PostalTradeAddress/ram:CountryID) != '')">
    <svrl:failed-assert id="BR-20" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-20]-The Seller tax representative postal address (BG-12) shall contain a Tax representative country code (BT-69), if the Seller (BG-4) has a Seller tax representative party (BG-11).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(normalize-space(ram:SpecifiedTaxRegistration/ram:ID[@schemeID='VA']) != '')">
    <svrl:failed-assert id="BR-56" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-56]-Each Seller tax representative party (BG-11) shall have a Seller tax representative VAT identifier (BT-63).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:SpecifiedTradeSettlementHeaderMonetarySummation/ram:TaxTotalAmount[@currencyID=/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:InvoiceCurrencyCode] [EN16931-CII-Model] -->
<xsl:template match="ram:SpecifiedTradeSettlementHeaderMonetarySummation/ram:TaxTotalAmount[@currencyID=/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:InvoiceCurrencyCode]" mode="svrl" priority="121">
  <xsl:if test="not(. = (round(sum(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax/ram:CalculatedAmount)*10*10)div 100))">
    <svrl:failed-assert id="BR-CO-14" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-CO-14]-Invoice total VAT amount (BT-110) = Σ VAT category tax amount (BT-117).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:SpecifiedTaxRegistration/ram:ID[@schemeID='VA'] [EN16931-CII-Model] -->
<xsl:template match="ram:SpecifiedTaxRegistration/ram:ID[@schemeID='VA']" mode="svrl" priority="122">
  <xsl:if test="not(contains(' 1A AD AE AF AG AI AL AM AN AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BL BJ BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH EL ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XI YE YT ZA ZM ZW ', concat(' ', substring(.,1,2), ' ')))">
    <svrl:failed-assert id="BR-CO-09" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-CO-09]-The Seller VAT identifier (BT-31), the Seller tax representative VAT identifier (BT-63) and the Buyer VAT identifier (BT-48) shall have a prefix in accordance with ISO code ISO 3166-1 alpha-2 by which the country of issue may be identified. Nevertheless, Greece may use the prefix ‘EL’.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax/ram:CategoryCode[. = 'AE'][upper-case(../ram:TypeCode) = 'VAT'] [EN16931-CII-Model] -->
<xsl:template match="rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax/ram:CategoryCode[. = 'AE'][upper-case(../ram:TypeCode) = 'VAT']" mode="svrl" priority="123">
  <xsl:if test="not((../ram:BasisAmount -1 < (round(sum(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeSettlement[ram:ApplicableTradeTax/ram:CategoryCode = 'AE']/ram:SpecifiedTradeSettlementLineMonetarySummation/xs:decimal(ram:LineTotalAmount))*10*10)div 100) + (round(sum(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator=true() and ram:CategoryTradeTax/ram:CategoryCode='AE']/xs:decimal(ram:ActualAmount[1]))*10*10)div 100) - (round(sum(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator=false() and ram:CategoryTradeTax/ram:CategoryCode='AE']/xs:decimal(ram:ActualAmount[1]))*10*10)div 100)) and (../ram:BasisAmount +1 > (round(sum(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeSettlement[ram:ApplicableTradeTax/ram:CategoryCode = 'AE']/ram:SpecifiedTradeSettlementLineMonetarySummation/xs:decimal(ram:LineTotalAmount))*10*10)div 100) + (round(sum(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator=true() and ram:CategoryTradeTax/ram:CategoryCode='AE']/xs:decimal(ram:ActualAmount[1]))*10*10)div 100) - (round(sum(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator=false() and ram:CategoryTradeTax/ram:CategoryCode='AE']/xs:decimal(ram:ActualAmount[1]))*10*10)div 100)))">
    <svrl:failed-assert id="BR-AE-08" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-AE-08]-In a VAT breakdown (BG-23) where the VAT category code (BT-118) is "Reverse charge" the VAT category taxable amount (BT-116) shall equal the sum of Invoice line net amounts (BT-131) minus the sum of Document level allowance amounts (BT-92) plus the sum of Document level charge amounts (BT-99) where the VAT category codes (BT-151, BT-95, BT-102) are "Reverse charge".</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(../ram:CalculatedAmount = 0)">
    <svrl:failed-assert id="BR-AE-09" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-AE-09]-The VAT category tax amount (BT-117) in a VAT breakdown (BG-23) where the VAT category code (BT-118) is "Reverse charge" shall be 0 (zero).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not((../ram:ExemptionReason) or (../ram:ExemptionReasonCode))">
    <svrl:failed-assert id="BR-AE-10" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-AE-10]-A VAT Breakdown (BG-23) with VAT Category code (BT-118) "Reverse charge" shall have a VAT exemption reason code (BT-121), meaning "Reverse charge" or the VAT exemption reason text (BT-120) "Reverse charge" (or the equivalent standard text in another language).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator=false()]/ram:CategoryTradeTax[ram:CategoryCode = 'AE'][upper-case(ram:TypeCode) = 'VAT'] [EN16931-CII-Model] -->
<xsl:template match="ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator=false()]/ram:CategoryTradeTax[ram:CategoryCode = 'AE'][upper-case(ram:TypeCode) = 'VAT']" mode="svrl" priority="124">
  <xsl:if test="not((//ram:SellerTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID = ('VA', 'FC')] or //ram:SellerTaxRepresentativeTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID = 'VA']) and (//ram:BuyerTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID = 'VA'] or //ram:BuyerTradeParty/ram:SpecifiedLegalOrganization/ram:ID))">
    <svrl:failed-assert id="BR-AE-03" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-AE-03]-An Invoice that contains a Document level allowance (BG-20) where the Document level allowance VAT category code (BT-95) is "Reverse charge" shall contain the Seller VAT Identifier (BT-31), the Seller tax registration identifier (BT-32) and/or the Seller tax representative VAT identifier (BT-63) and the Buyer VAT identifier (BT-48) and/or the Buyer legal registration identifier (BT-47).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(ram:RateApplicablePercent = 0)">
    <svrl:failed-assert id="BR-AE-06" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-AE-06]-In a Document level allowance (BG-20) where the Document level allowance VAT category code (BT-95) is "Reverse charge" the Document level allowance VAT rate (BT-96) shall be 0 (zero).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator=true()]/ram:CategoryTradeTax[ram:CategoryCode = 'AE'][upper-case(ram:TypeCode) = 'VAT'] [EN16931-CII-Model] -->
<xsl:template match="ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator=true()]/ram:CategoryTradeTax[ram:CategoryCode = 'AE'][upper-case(ram:TypeCode) = 'VAT']" mode="svrl" priority="125">
  <xsl:if test="not((//ram:SellerTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID = ('VA', 'FC')] or //ram:SellerTaxRepresentativeTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID = 'VA']) and (//ram:BuyerTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID = 'VA'] or //ram:BuyerTradeParty/ram:SpecifiedLegalOrganization/ram:ID))">
    <svrl:failed-assert id="BR-AE-04" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-AE-04]-An Invoice that contains a Document level charge (BG-21) where the Document level charge VAT category code (BT-102) is "Reverse charge" shall contain the Seller VAT Identifier (BT-31), the Seller tax registration identifier (BT-32) and/or the Seller tax representative VAT identifier (BT-63) and the Buyer VAT identifier (BT-48) and/or the Buyer legal registration identifier (BT-47).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(ram:RateApplicablePercent = 0)">
    <svrl:failed-assert id="BR-AE-07" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-AE-07]-In a Document level charge (BG-21) where the Document level charge VAT category code (BT-102) is "Reverse charge" the Document level charge VAT rate (BT-103) shall be 0 (zero).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax[ram:CategoryCode = 'AE'][upper-case(ram:TypeCode) = 'VAT'] [EN16931-CII-Model] -->
<xsl:template match="rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax[ram:CategoryCode = 'AE'][upper-case(ram:TypeCode) = 'VAT']" mode="svrl" priority="126">
  <xsl:if test="not((//ram:SellerTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID = ('VA', 'FC')] or //ram:SellerTaxRepresentativeTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID = 'VA']) and (//ram:BuyerTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID = 'VA'] or //ram:BuyerTradeParty/ram:SpecifiedLegalOrganization/ram:ID))">
    <svrl:failed-assert id="BR-AE-02" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-AE-02]-An Invoice that contains an Invoice line (BG-25) where the Invoiced item VAT category code (BT-151) is "Reverse charge" shall contain the Seller VAT Identifier (BT-31), the Seller Tax registration identifier (BT-32) and/or the Seller tax representative VAT identifier (BT-63) and the Buyer VAT identifier (BT-48) and/or the Buyer legal registration identifier (BT-47).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(ram:RateApplicablePercent = 0)">
    <svrl:failed-assert id="BR-AE-05" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-AE-05]-In an Invoice line (BG-25) where the Invoiced item VAT category code (BT-151) is "Reverse charge" the Invoiced item VAT rate (BT-152) shall be 0 (zero).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax[ram:CategoryCode = 'L'][upper-case(ram:TypeCode) = 'VAT'] [EN16931-CII-Model] -->
<xsl:template match="rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax[ram:CategoryCode = 'L'][upper-case(ram:TypeCode) = 'VAT']" mode="svrl" priority="127">
  <xsl:if test="not(every $rate in ../ram:RateApplicablePercent/xs:decimal(.) satisfies (../ram:BasisAmount = (round(sum(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeSettlement[ram:ApplicableTradeTax/ram:CategoryCode = 'L' and ram:ApplicableTradeTax/xs:decimal(ram:RateApplicablePercent) =$rate]/ram:SpecifiedTradeSettlementLineMonetarySummation/xs:decimal(ram:LineTotalAmount)) * 10 * 10) div 100 + round(sum(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator=true() and ram:CategoryTradeTax/ram:CategoryCode='L' and ram:CategoryTradeTax/xs:decimal(ram:RateApplicablePercent)=$rate]/xs:decimal(ram:ActualAmount[1])) * 10 * 10) div 100 - round(sum(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator=false() and ram:CategoryTradeTax/ram:CategoryCode='L' and ram:CategoryTradeTax/xs:decimal(ram:RateApplicablePercent)=$rate]/xs:decimal(ram:ActualAmount[1])) * 10 * 10) div 100)))">
    <svrl:failed-assert id="BR-AF-08" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-AF-08]-For each different value of VAT category rate (BT-119) where the VAT category code (BT-118) is "IGIC", the VAT category taxable amount (BT-116) in a VAT breakdown (BG-23) shall equal the sum of Invoice line net amounts (BT-131) plus the sum of document level charge amounts (BT-99) minus the sum of document level allowance amounts (BT-92) where the VAT category code (BT-151, BT-102, BT-95) is "IGIC" and the VAT rate (BT-152, BT-103, BT-96) equals the VAT category rate (BT-119).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(true())">
    <svrl:failed-assert id="BR-AF-09" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-AF-09]-The VAT category tax amount (BT-117) in a VAT breakdown (BG-23) where VAT category code (BT-118) is "IGIC" shall equal the VAT category taxable amount (BT-116) multiplied by the VAT category rate (BT-119).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ExemptionReason) and not (ram:ExemptionReasonCode))">
    <svrl:failed-assert id="BR-AF-10" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-AF-10]-A VAT Breakdown (BG-23) with VAT Category code (BT-118) "IGIC" shall not have a VAT exemption reason code (BT-121) or VAT exemption reason text (BT-120).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax[ram:CategoryCode = 'L'][upper-case(ram:TypeCode) = 'VAT'] [EN16931-CII-Model] -->
<xsl:template match="rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax[ram:CategoryCode = 'L'][upper-case(ram:TypeCode) = 'VAT']" mode="svrl" priority="128">
  <xsl:if test="not(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SellerTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID = ('VA', 'FC')] or /rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SellerTaxRepresentativeTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID = 'VA'])">
    <svrl:failed-assert id="BR-AF-02" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-AF-02]-An Invoice that contains an Invoice line (BG-25) where the Invoiced item VAT category code (BT-151) is "IGIC" shall contain the Seller VAT Identifier (BT-31), the Seller tax registration identifier (BT-32) and/or the Seller tax representative VAT identifier (BT-63).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(ram:RateApplicablePercent > 0)">
    <svrl:failed-assert id="BR-AF-05" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-AF-05]-In an Invoice line (BG-25) where the Invoiced item VAT category code (BT-151) is "IGIC" the invoiced item VAT rate (BT-152) shall be greater than 0 (zero).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator=false()]/ram:CategoryTradeTax[ram:CategoryCode = 'L'][upper-case(ram:TypeCode) = 'VAT'] [EN16931-CII-Model] -->
<xsl:template match="ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator=false()]/ram:CategoryTradeTax[ram:CategoryCode = 'L'][upper-case(ram:TypeCode) = 'VAT']" mode="svrl" priority="129">
  <xsl:if test="not(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SellerTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID = ('VA', 'FC')] or /rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SellerTaxRepresentativeTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID = 'VA'])">
    <svrl:failed-assert id="BR-AF-03" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-AF-03]-An Invoice that contains a Document level allowance (BG-20) where the Document level allowance VAT category code (BT-95) is "IGIC" shall contain the Seller VAT Identifier (BT-31), the Seller tax registration identifier (BT-32) and/or the Seller tax representative VAT identifier (BT-63).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(ram:RateApplicablePercent > 0)">
    <svrl:failed-assert id="BR-AF-06" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-AF-06]-In a Document level allowance (BG-20) where the Document level allowance VAT category code (BT-95) is "IGIC" the Document level allowance VAT rate (BT-96) shall be 0 (zero) or greater than zero.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator=true()]/ram:CategoryTradeTax[ram:CategoryCode = 'L'][upper-case(ram:TypeCode) = 'VAT'] [EN16931-CII-Model] -->
<xsl:template match="ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator=true()]/ram:CategoryTradeTax[ram:CategoryCode = 'L'][upper-case(ram:TypeCode) = 'VAT']" mode="svrl" priority="130">
  <xsl:if test="not(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SellerTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID = ('VA', 'FC')] or /rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SellerTaxRepresentativeTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID = 'VA'])">
    <svrl:failed-assert id="BR-AF-04" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-AF-04]-An Invoice that contains a Document level charge (BG-21) where the Document level charge VAT category code (BT-102) is "IGIC" shall contain the Seller VAT Identifier (BT-31), the Seller Tax registration identifier (BT-32) and/or the Seller tax representative VAT identifier (BT-63).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(ram:RateApplicablePercent > 0)">
    <svrl:failed-assert id="BR-AF-07" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-AF-07]-In a Document level charge (BG-21) where the Document level charge VAT category code (BT-102) is "IGIC" the Document level charge VAT rate (BT-103) shall be 0 (zero) or greater than zero.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax[ram:CategoryCode = 'M'][upper-case(ram:TypeCode) = 'VAT'] [EN16931-CII-Model] -->
<xsl:template match="rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax[ram:CategoryCode = 'M'][upper-case(ram:TypeCode) = 'VAT']" mode="svrl" priority="131">
  <xsl:if test="not(every $rate in ../ram:RateApplicablePercent/xs:decimal(.) satisfies (../ram:BasisAmount = (round(sum(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeSettlement[ram:ApplicableTradeTax/ram:CategoryCode = 'M' and ram:ApplicableTradeTax/xs:decimal(ram:RateApplicablePercent) =$rate]/ram:SpecifiedTradeSettlementLineMonetarySummation/xs:decimal(ram:LineTotalAmount)) * 10 * 10) div 100 + round(sum(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator=true() and ram:CategoryTradeTax/ram:CategoryCode='M' and ram:CategoryTradeTax/xs:decimal(ram:RateApplicablePercent)=$rate]/xs:decimal(ram:ActualAmount[1])) * 10 * 10) div 100 - round(sum(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator=false() and ram:CategoryTradeTax/ram:CategoryCode='M' and ram:CategoryTradeTax/xs:decimal(ram:RateApplicablePercent)=$rate]/xs:decimal(ram:ActualAmount[1])) * 10 * 10) div 100)))">
    <svrl:failed-assert id="BR-AG-08" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-AG-08]-For each different value of VAT category rate (BT-119) where the VAT category code (BT-118) is "IPSI", the VAT category taxable amount (BT-116) in a VAT breakdown (BG-23) shall equal the sum of Invoice line net amounts (BT-131) plus the sum of document level charge amounts (BT-99) minus the sum of document level allowance amounts (BT-92) where the VAT category code (BT-151, BT-102, BT-95) is "IPSI" and the VAT rate (BT-152, BT-103, BT-96) equals the VAT category rate (BT-119).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(true())">
    <svrl:failed-assert id="BR-AG-09" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-AG-09]-The VAT category tax amount (BT-117) in a VAT breakdown (BG-23) where VAT category code (BT-118) is "IPSI" shall equal the VAT category taxable amount (BT-116) multiplied by the VAT category rate (BT-119).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ExemptionReason) and not (ram:ExemptionReasonCode))">
    <svrl:failed-assert id="BR-AG-10" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-AG-10]-A VAT Breakdown (BG-23) with VAT Category code (BT-118) "IPSI" shall not have a VAT exemption reason code (BT-121) or VAT exemption reason text (BT-120).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax[ram:CategoryCode = 'M'][upper-case(ram:TypeCode) = 'VAT'] [EN16931-CII-Model] -->
<xsl:template match="rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax[ram:CategoryCode = 'M'][upper-case(ram:TypeCode) = 'VAT']" mode="svrl" priority="132">
  <xsl:if test="not(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SellerTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID = ('VA', 'FC')] or /rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SellerTaxRepresentativeTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID = 'VA'])">
    <svrl:failed-assert id="BR-AG-02" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-AG-02]-An Invoice that contains an Invoice line (BG-25) where the Invoiced item VAT category code (BT-151) is "IPSI" shall contain the Seller VAT Identifier (BT-31), the Seller tax registration identifier (BT-32) and/or the Seller tax representative VAT identifier (BT-63).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(ram:RateApplicablePercent >= 0)">
    <svrl:failed-assert id="BR-AG-05" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-AG-05]-In an Invoice line (BG-25) where the Invoiced item VAT category code (BT-151) is "IPSI" the Invoiced item VAT rate (BT-152) shall be 0 (zero) or greater than zero.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator=false()]/ram:CategoryTradeTax[ram:CategoryCode = 'M'][upper-case(ram:TypeCode) = 'VAT'] [EN16931-CII-Model] -->
<xsl:template match="ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator=false()]/ram:CategoryTradeTax[ram:CategoryCode = 'M'][upper-case(ram:TypeCode) = 'VAT']" mode="svrl" priority="133">
  <xsl:if test="not(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SellerTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID = ('VA', 'FC')] or /rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SellerTaxRepresentativeTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID = 'VA'])">
    <svrl:failed-assert id="BR-AG-03" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-AG-03]-An Invoice that contains a Document level allowance (BG-20) where the Document level allowance VAT category code (BT-95) is "IPSI" shall contain the Seller VAT Identifier (BT-31), the Seller Tax registration identifier (BT-32) and/or the Seller tax representative VAT identifier (BT-63).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(ram:RateApplicablePercent >= 0)">
    <svrl:failed-assert id="BR-AG-06" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-AG-06]-In a Document level allowance (BG-20) where the Document level allowance VAT category code (BT-95) is "IPSI" the Document level allowance VAT rate (BT-96) shall be 0 (zero) or greater than zero.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator=true()]/ram:CategoryTradeTax[ram:CategoryCode = 'M'][upper-case(ram:TypeCode) = 'VAT'] [EN16931-CII-Model] -->
<xsl:template match="ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator=true()]/ram:CategoryTradeTax[ram:CategoryCode = 'M'][upper-case(ram:TypeCode) = 'VAT']" mode="svrl" priority="134">
  <xsl:if test="not(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SellerTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID = ('VA', 'FC')] or /rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SellerTaxRepresentativeTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID = 'VA'])">
    <svrl:failed-assert id="BR-AG-04" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-AG-04]-An Invoice that contains a Document level charge (BG-21) where the Document level charge VAT category code (BT-102) is "IPSI" shall contain the Seller VAT Identifier (BT-31), the Seller Tax registration identifier (BT-32) and/or the Seller tax representative VAT identifier (BT-63).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(ram:RateApplicablePercent >= 0)">
    <svrl:failed-assert id="BR-AG-07" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-AG-07]-In a Document level charge (BG-21) where the Document level charge VAT category code (BT-102) is "IPSI" the Document level charge VAT rate (BT-103) shall be 0 (zero) or greater than zero.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax/ram:CategoryCode[. = 'E'][upper-case(../ram:TypeCode) = 'VAT'] [EN16931-CII-Model] -->
<xsl:template match="rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax/ram:CategoryCode[. = 'E'][upper-case(../ram:TypeCode) = 'VAT']" mode="svrl" priority="135">
  <xsl:if test="not((../ram:BasisAmount - 1 < (round(sum(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeSettlement[ram:ApplicableTradeTax/ram:CategoryCode = 'E']/ram:SpecifiedTradeSettlementLineMonetarySummation/xs:decimal(ram:LineTotalAmount))*10*10)div 100) + (round(sum(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator=true() and ram:CategoryTradeTax/ram:CategoryCode='E']/xs:decimal(ram:ActualAmount[1]))*10*10)div 100) - (round(sum(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator=false() and ram:CategoryTradeTax/ram:CategoryCode='E']/xs:decimal(ram:ActualAmount[1]))*10*10)div 100)) and (../ram:BasisAmount + 1 > (round(sum(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeSettlement[ram:ApplicableTradeTax/ram:CategoryCode = 'E']/ram:SpecifiedTradeSettlementLineMonetarySummation/xs:decimal(ram:LineTotalAmount))*10*10)div 100) + (round(sum(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator=true() and ram:CategoryTradeTax/ram:CategoryCode='E']/xs:decimal(ram:ActualAmount[1]))*10*10)div 100) - (round(sum(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator=false() and ram:CategoryTradeTax/ram:CategoryCode='E']/xs:decimal(ram:ActualAmount[1]))*10*10)div 100)))">
    <svrl:failed-assert id="BR-E-08" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-E-08]-In a VAT breakdown (BG-23) where the VAT category code (BT-118) is "Exempt from VAT" the VAT category taxable amount (BT-116) shall equal the sum of Invoice line net amounts (BT-131) minus the sum of Document level allowance amounts (BT-92) plus the sum of Document level charge amounts (BT-99) where the VAT category codes (BT-151, BT-95, BT-102) are "Exempt from VAT".</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(../ram:CalculatedAmount = 0)">
    <svrl:failed-assert id="BR-E-09" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-E-09]-The VAT category tax amount (BT-117) In a VAT breakdown (BG-23) where the VAT category code (BT-118) equals "Exempt from VAT" shall equal 0 (zero).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not((../ram:ExemptionReason) or (../ram:ExemptionReasonCode))">
    <svrl:failed-assert id="BR-E-10" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-E-10]-A VAT Breakdown (BG-23) with VAT Category code (BT-118) "Exempt from VAT" shall have a VAT exemption reason code (BT-121) or a VAT exemption reason text (BT-120).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator=false()]/ram:CategoryTradeTax[ram:CategoryCode = 'E'][upper-case(ram:TypeCode) = 'VAT'] [EN16931-CII-Model] -->
<xsl:template match="ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator=false()]/ram:CategoryTradeTax[ram:CategoryCode = 'E'][upper-case(ram:TypeCode) = 'VAT']" mode="svrl" priority="136">
  <xsl:if test="not(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SellerTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID = ('VA', 'FC')] or /rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SellerTaxRepresentativeTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID = 'VA'])">
    <svrl:failed-assert id="BR-E-03" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-E-03]-An Invoice that contains a Document level allowance (BG-20) where the Document level allowance VAT category code (BT-95) is "Exempt from VAT" shall contain the Seller VAT Identifier (BT-31), the Seller tax registration identifier (BT-32) and/or the Seller tax representative VAT identifier (BT-63).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(ram:RateApplicablePercent = 0)">
    <svrl:failed-assert id="BR-E-06" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-E-06]-In a Document level allowance (BG-20) where the Document level allowance VAT category code (BT-95) is "Exempt from VAT", the Document level allowance VAT rate (BT-96) shall be 0 (zero).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator=true()]/ram:CategoryTradeTax[ram:CategoryCode = 'E'][upper-case(ram:TypeCode) = 'VAT'] [EN16931-CII-Model] -->
<xsl:template match="ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator=true()]/ram:CategoryTradeTax[ram:CategoryCode = 'E'][upper-case(ram:TypeCode) = 'VAT']" mode="svrl" priority="137">
  <xsl:if test="not(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SellerTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID = ('VA', 'FC')] or /rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SellerTaxRepresentativeTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID = 'VA'])">
    <svrl:failed-assert id="BR-E-04" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-E-04]-An Invoice that contains a Document level charge (BG-21) where the Document level charge VAT category code (BT-102) is "Exempt from VAT" shall contain the Seller VAT Identifier (BT-31), the Seller tax registration identifier (BT-32) and/or the Seller tax representative VAT identifier (BT-63).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(ram:RateApplicablePercent = 0)">
    <svrl:failed-assert id="BR-E-07" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-E-07]-In a Document level charge (BG-21) where the Document level charge VAT category code (BT-102) is "Exempt from VAT", the Document level charge VAT rate (BT-103) shall be 0 (zero).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax[ram:CategoryCode = 'E'][upper-case(ram:TypeCode) = 'VAT'] [EN16931-CII-Model] -->
<xsl:template match="rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax[ram:CategoryCode = 'E'][upper-case(ram:TypeCode) = 'VAT']" mode="svrl" priority="138">
  <xsl:if test="not(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SellerTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID = ('VA', 'FC')] or /rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SellerTaxRepresentativeTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID = 'VA'])">
    <svrl:failed-assert id="BR-E-02" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-E-02]-An Invoice that contains an Invoice line (BG-25) where the Invoiced item VAT category code (BT-151) is "Exempt from VAT" shall contain the Seller VAT Identifier (BT-31), the Seller tax registration identifier (BT-32) and/or the Seller tax representative VAT identifier (BT-63).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(ram:RateApplicablePercent = 0)">
    <svrl:failed-assert id="BR-E-05" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-E-05]-In an Invoice line (BG-25) where the Invoiced item VAT category code (BT-151) is "Exempt from VAT", the Invoiced item VAT rate (BT-152) shall be 0 (zero).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax/ram:CategoryCode[. = 'G'][upper-case(../ram:TypeCode) = 'VAT'] [EN16931-CII-Model] -->
<xsl:template match="rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax/ram:CategoryCode[. = 'G'][upper-case(../ram:TypeCode) = 'VAT']" mode="svrl" priority="139">
  <xsl:if test="not((../ram:BasisAmount -1 < (round(sum(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeSettlement[ram:ApplicableTradeTax/ram:CategoryCode = 'G']/ram:SpecifiedTradeSettlementLineMonetarySummation/xs:decimal(ram:LineTotalAmount))*10*10)div 100) + (round(sum(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator=true() and ram:CategoryTradeTax/ram:CategoryCode='G']/xs:decimal(ram:ActualAmount[1]))*10*10)div 100) - (round(sum(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator=false() and ram:CategoryTradeTax/ram:CategoryCode='G']/xs:decimal(ram:ActualAmount[1]))*10*10)div 100)) and (../ram:BasisAmount +1 > (round(sum(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeSettlement[ram:ApplicableTradeTax/ram:CategoryCode = 'G']/ram:SpecifiedTradeSettlementLineMonetarySummation/xs:decimal(ram:LineTotalAmount))*10*10)div 100) + (round(sum(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator=true() and ram:CategoryTradeTax/ram:CategoryCode='G']/xs:decimal(ram:ActualAmount[1]))*10*10)div 100) - (round(sum(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator=false() and ram:CategoryTradeTax/ram:CategoryCode='G']/xs:decimal(ram:ActualAmount[1]))*10*10)div 100)))">
    <svrl:failed-assert id="BR-G-08" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-G-08]-In a VAT breakdown (BG-23) where the VAT category code (BT-118) is "Export outside the EU" the VAT category taxable amount (BT-116) shall equal the sum of Invoice line net amounts (BT-131) minus the sum of Document level allowance amounts (BT-92) plus the sum of Document level charge amounts (BT-99) where the VAT category codes (BT-151, BT-95, BT-102) are "Export outside the EU".</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(../ram:CalculatedAmount = 0)">
    <svrl:failed-assert id="BR-G-09" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-G-09]-The VAT category tax amount (BT-117) in a VAT breakdown (BG-23) where the VAT category code (BT-118) is "Export outside the EU" shall be 0 (zero).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not((../ram:ExemptionReason) or (../ram:ExemptionReasonCode))">
    <svrl:failed-assert id="BR-G-10" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-G-10]-A VAT Breakdown (BG-23) with the VAT Category code (BT-118) "Export outside the EU" shall have a VAT exemption reason code (BT-121), meaning "Export outside the EU" or the VAT exemption reason text (BT-120) "Export outside the EU" (or the equivalent standard text in another language).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator=false()]/ram:CategoryTradeTax[ram:CategoryCode = 'G'][upper-case(ram:TypeCode) = 'VAT'] [EN16931-CII-Model] -->
<xsl:template match="ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator=false()]/ram:CategoryTradeTax[ram:CategoryCode = 'G'][upper-case(ram:TypeCode) = 'VAT']" mode="svrl" priority="140">
  <xsl:if test="not((//ram:SellerTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID = 'VA'] or //ram:SellerTaxRepresentativeTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID = 'VA']))">
    <svrl:failed-assert id="BR-G-03" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-G-03]-An Invoice that contains a Document level allowance (BG-20) where the Document level allowance VAT category code (BT-95) is "Export outside the EU" shall contain the Seller VAT Identifier (BT-31) or the Seller tax representative VAT identifier (BT-63).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(ram:RateApplicablePercent = 0)">
    <svrl:failed-assert id="BR-G-06" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-G-06]-In a Document level allowance (BG-20) where the Document level allowance VAT category code (BT-95) is "Export outside the EU" the Document level allowance VAT rate (BT-96) shall be 0 (zero).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator=true()]/ram:CategoryTradeTax[ram:CategoryCode = 'G'][upper-case(ram:TypeCode) = 'VAT'] [EN16931-CII-Model] -->
<xsl:template match="ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator=true()]/ram:CategoryTradeTax[ram:CategoryCode = 'G'][upper-case(ram:TypeCode) = 'VAT']" mode="svrl" priority="141">
  <xsl:if test="not((//ram:SellerTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID = 'VA'] or //ram:SellerTaxRepresentativeTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID = 'VA']))">
    <svrl:failed-assert id="BR-G-04" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-G-04]-An Invoice that contains a Document level charge (BG-21) where the Document level charge VAT category code (BT-102) is "Export outside the EU" shall contain the Seller VAT Identifier (BT-31) or the Seller tax representative VAT identifier (BT-63).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(ram:RateApplicablePercent = 0)">
    <svrl:failed-assert id="BR-G-07" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-G-07]-In a Document level charge (BG-21) where the Document level charge VAT category code (BT-102) is "Export outside the EU" the Document level charge VAT rate (BT-103) shall be 0 (zero).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax[ram:CategoryCode = 'G'][upper-case(ram:TypeCode) = 'VAT'] [EN16931-CII-Model] -->
<xsl:template match="rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax[ram:CategoryCode = 'G'][upper-case(ram:TypeCode) = 'VAT']" mode="svrl" priority="142">
  <xsl:if test="not((//ram:SellerTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID = 'VA'] or //ram:SellerTaxRepresentativeTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID = 'VA']))">
    <svrl:failed-assert id="BR-G-02" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-G-02]-An Invoice that contains an Invoice line (BG-25) where the Invoiced item VAT category code (BT-151) is "Export outside the EU" shall contain the Seller VAT Identifier (BT-31) or the Seller tax representative VAT identifier (BT-63).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(ram:RateApplicablePercent = 0)">
    <svrl:failed-assert id="BR-G-05" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-G-05]-In an Invoice line (BG-25) where the Invoiced item VAT category code (BT-151) is "Export outside the EU" the Invoiced item VAT rate (BT-152) shall be 0 (zero).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax/ram:CategoryCode[.= 'K'][upper-case(../ram:TypeCode) = 'VAT'] [EN16931-CII-Model] -->
<xsl:template match="rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax/ram:CategoryCode[.= 'K'][upper-case(../ram:TypeCode) = 'VAT']" mode="svrl" priority="143">
  <xsl:if test="not((../ram:BasisAmount - 1 < (round(sum(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeSettlement[ram:ApplicableTradeTax/ram:CategoryCode = 'K']/ram:SpecifiedTradeSettlementLineMonetarySummation/xs:decimal(ram:LineTotalAmount))*10*10)div 100) + (round(sum(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator=true() and ram:CategoryTradeTax/ram:CategoryCode='K']/xs:decimal(ram:ActualAmount[1]))*10*10)div 100) - (round(sum(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator=false() and ram:CategoryTradeTax/ram:CategoryCode='K']/xs:decimal(ram:ActualAmount[1]))*10*10)div 100)) and (../ram:BasisAmount + 1 > (round(sum(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeSettlement[ram:ApplicableTradeTax/ram:CategoryCode = 'K']/ram:SpecifiedTradeSettlementLineMonetarySummation/xs:decimal(ram:LineTotalAmount))*10*10)div 100) + (round(sum(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator=true() and ram:CategoryTradeTax/ram:CategoryCode='K']/xs:decimal(ram:ActualAmount[1]))*10*10)div 100) - (round(sum(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator=false() and ram:CategoryTradeTax/ram:CategoryCode='K']/xs:decimal(ram:ActualAmount[1]))*10*10)div 100)))">
    <svrl:failed-assert id="BR-IC-08" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-IC-08]-In a VAT breakdown (BG-23) where the VAT category code (BT-118) is "Intra-community supply" the VAT category taxable amount (BT-116) shall equal the sum of Invoice line net amounts (BT-131) minus the sum of Document level allowance amounts (BT-92) plus the sum of Document level charge amounts (BT-99) where the VAT category codes (BT-151, BT-95, BT-102) are "Intra-community supply".</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(../ram:CalculatedAmount = 0)">
    <svrl:failed-assert id="BR-IC-09" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-IC-09]-The VAT category tax amount (BT-117) in a VAT breakdown (BG-23) where the VAT category code (BT-118) is "Intra-community supply" shall be 0 (zero).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not((../ram:ExemptionReason) or (../ram:ExemptionReasonCode))">
    <svrl:failed-assert id="BR-IC-10" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-IC-10]-A VAT Breakdown (BG-23) with the VAT Category code (BT-118) "Intra-community supply" shall have a VAT exemption reason code (BT-121), meaning "Intra-community supply" or the VAT exemption reason text (BT-120) "Intra-community supply" (or the equivalent standard text in another language).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not((/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeDelivery/ram:ActualDeliverySupplyChainEvent/ram:OccurrenceDateTime/udt:DateTimeString) or (../../ram:BillingSpecifiedPeriod/ram:StartDateTime) or (../../ram:BillingSpecifiedPeriod/ram:EndDateTime))">
    <svrl:failed-assert id="BR-IC-11" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-IC-11]-In an Invoice with a VAT breakdown (BG-23) where the VAT category code (BT-118) is "Intra-community supply" the Actual delivery date (BT-72) or the Invoicing period (BG-14) shall not be blank.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeDelivery/ram:ShipToTradeParty/ram:PostalTradeAddress/ram:CountryID)">
    <svrl:failed-assert id="BR-IC-12" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-IC-12]-In an Invoice with a VAT breakdown (BG-23) where the VAT category code (BT-118) is "Intra-community supply" the Deliver to country code (BT-80) shall not be blank.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator=false()]/ram:CategoryTradeTax[ram:CategoryCode = 'K'][upper-case(ram:TypeCode) = 'VAT'] [EN16931-CII-Model] -->
<xsl:template match="ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator=false()]/ram:CategoryTradeTax[ram:CategoryCode = 'K'][upper-case(ram:TypeCode) = 'VAT']" mode="svrl" priority="144">
  <xsl:if test="not((//ram:SellerTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID = 'VA'] or //ram:SellerTaxRepresentativeTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID = 'VA']) and //ram:BuyerTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID = 'VA'])">
    <svrl:failed-assert id="BR-IC-03" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-IC-03]-An Invoice that contains a Document level allowance (BG-20) where the Document level allowance VAT category code (BT-95) is "Intra-community supply" shall contain the Seller VAT Identifier (BT-31) or the Seller tax representative VAT identifier (BT-63) and the Buyer VAT identifier (BT-48).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(ram:RateApplicablePercent = 0)">
    <svrl:failed-assert id="BR-IC-06" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-IC-06]-In a Document level allowance (BG-20) where the Document level allowance VAT category code (BT-95) is "Intra-community supply" the Document level allowance VAT rate (BT-96) shall be 0 (zero).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator=true()]/ram:CategoryTradeTax[ram:CategoryCode = 'K'][upper-case(ram:TypeCode) = 'VAT'] [EN16931-CII-Model] -->
<xsl:template match="ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator=true()]/ram:CategoryTradeTax[ram:CategoryCode = 'K'][upper-case(ram:TypeCode) = 'VAT']" mode="svrl" priority="145">
  <xsl:if test="not((//ram:SellerTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID = 'VA'] or //ram:SellerTaxRepresentativeTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID = 'VA']) and //ram:BuyerTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID = 'VA'])">
    <svrl:failed-assert id="BR-IC-04" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-IC-04]-An Invoice that contains a Document level charge (BG-21) where the Document level charge VAT category code (BT-102) is "Intra-community supply" shall contain the Seller VAT Identifier (BT-31) or the Seller tax representative VAT identifier (BT-63) and the Buyer VAT identifier (BT-48).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(ram:RateApplicablePercent = 0)">
    <svrl:failed-assert id="BR-IC-07" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-IC-07]-In a Document level charge (BG-21) where the Document level charge VAT category code (BT-102) is "Intra-community supply" the Document level charge VAT rate (BT-103) shall be 0 (zero).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax[ram:CategoryCode = 'K'][upper-case(ram:TypeCode) = 'VAT'] [EN16931-CII-Model] -->
<xsl:template match="rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax[ram:CategoryCode = 'K'][upper-case(ram:TypeCode) = 'VAT']" mode="svrl" priority="146">
  <xsl:if test="not((//ram:SellerTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID = 'VA'] or //ram:SellerTaxRepresentativeTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID = 'VA']) and //ram:BuyerTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID = 'VA'])">
    <svrl:failed-assert id="BR-IC-02" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-IC-02]-An Invoice that contains an Invoice line (BG-25) where the Invoiced item VAT category code (BT-151) is "Intra-community supply" shall contain the Seller VAT Identifier (BT-31) or the Seller tax representative VAT identifier (BT-63) and the Buyer VAT identifier (BT-48).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(ram:RateApplicablePercent = 0)">
    <svrl:failed-assert id="BR-IC-05" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-IC-05]-In an Invoice line (BG-25) where the Invoiced item VAT category code (BT-151) is "Intracommunity supply" the Invoiced item VAT rate (BT-152) shall be 0 (zero).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax[ram:CategoryCode = 'O'][upper-case(ram:TypeCode) = 'VAT'] [EN16931-CII-Model] -->
<xsl:template match="rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax[ram:CategoryCode = 'O'][upper-case(ram:TypeCode) = 'VAT']" mode="svrl" priority="147">
  <xsl:if test="not(ram:BasisAmount = (round(sum(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeSettlement[ram:ApplicableTradeTax/ram:CategoryCode = 'O']/ram:SpecifiedTradeSettlementLineMonetarySummation/xs:decimal(ram:LineTotalAmount))*10*10)div 100) + (round(sum(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeAllowanceCharge[(ram:ChargeIndicator/udt:Indicator cast as xs:boolean)=true() and ram:CategoryTradeTax/ram:CategoryCode='O']/xs:decimal(ram:ActualAmount[1]))*10*10)div 100) - (round(sum(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeAllowanceCharge[(ram:ChargeIndicator/udt:Indicator cast as xs:boolean)=false() and ram:CategoryTradeTax/ram:CategoryCode='O']/xs:decimal(ram:ActualAmount[1]))*10*10)div 100))">
    <svrl:failed-assert id="BR-O-08" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-O-08]-In a VAT breakdown (BG-23) where the VAT category code (BT-118) is " Not subject to VAT" the VAT category taxable amount (BT-116) shall equal the sum of Invoice line net amounts (BT-131) minus the sum of Document level allowance amounts (BT-92) plus the sum of Document level charge amounts (BT-99) where the VAT category codes (BT-151, BT-95, BT-102) are "Not subject to VAT".</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(ram:CalculatedAmount = 0)">
    <svrl:failed-assert id="BR-O-09" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-O-09]-The VAT category tax amount (BT-117) in a VAT breakdown (BG-23) where the VAT category code (BT-118) is "Not subject to VAT" shall be 0 (zero).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not((ram:ExemptionReason) or (ram:ExemptionReasonCode))">
    <svrl:failed-assert id="BR-O-10" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-O-10]-A VAT Breakdown (BG-23) with VAT Category code (BT-118) " Not subject to VAT" shall have a VAT exemption reason code (BT-121), meaning " Not subject to VAT" or a VAT exemption reason text (BT-120) " Not subject to VAT" (or the equivalent standard text in another language).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(//ram:ApplicableTradeTax[ram:CategoryCode != 'O']))">
    <svrl:failed-assert id="BR-O-11" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-O-11]-An Invoice that contains a VAT breakdown group (BG-23) with a VAT category code (BT-118) "Not subject to VAT" shall not contain other VAT breakdown groups (BG-23).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(//ram:ApplicableTradeTax[ram:CategoryCode != 'O']))">
    <svrl:failed-assert id="BR-O-12" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-O-12]-An Invoice that contains a VAT breakdown group (BG-23) with a VAT category code (BT-118) "Not subject to VAT" shall not contain an Invoice line (BG-25) where the Invoiced item VAT category code (BT-151) is not "Not subject to VAT".</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(//ram:CategoryTradeTax[ram:CategoryCode != 'O']))">
    <svrl:failed-assert id="BR-O-13" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-O-13]-An Invoice that contains a VAT breakdown group (BG-23) with a VAT category code (BT-118) "Not subject to VAT" shall not contain Document level allowances (BG-20) where Document level allowance VAT category code (BT-95) is not "Not subject to VAT".</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(//ram:CategoryTradeTax[ram:CategoryCode != 'O']))">
    <svrl:failed-assert id="BR-O-14" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-O-14]-An Invoice that contains a VAT breakdown group (BG-23) with a VAT category code (BT-118) "Not subject to VAT" shall not contain Document level charges (BG-21) where Document level charge VAT category code (BT-102) is not "Not subject to VAT".</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator=false()]/ram:CategoryTradeTax[ram:CategoryCode = 'O'][upper-case(ram:TypeCode) = 'VAT'] [EN16931-CII-Model] -->
<xsl:template match="ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator=false()]/ram:CategoryTradeTax[ram:CategoryCode = 'O'][upper-case(ram:TypeCode) = 'VAT']" mode="svrl" priority="148">
  <xsl:if test="not(not(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SellerTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID = 'VA']) and not (/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SellerTaxRepresentativeTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID = 'VA']) and not (//ram:BuyerTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID = 'VA']))">
    <svrl:failed-assert id="BR-O-03" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-O-03]-An Invoice that contains a Document level allowance (BG-20) where the Document level allowance VAT category code (BT-95) is "Not subject to VAT" shall not contain the Seller VAT identifier (BT-31), the Seller tax representative VAT identifier (BT-63) or the Buyer VAT identifier (BT-48).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:RateApplicablePercent))">
    <svrl:failed-assert id="BR-O-06" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-O-06]-A Document level allowance (BG-20) where VAT category code (BT-95) is "Not subject to VAT" shall not contain a Document level allowance VAT rate (BT-96).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator=true()]/ram:CategoryTradeTax[ram:CategoryCode = 'O'][upper-case(ram:TypeCode) = 'VAT'] [EN16931-CII-Model] -->
<xsl:template match="ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator=true()]/ram:CategoryTradeTax[ram:CategoryCode = 'O'][upper-case(ram:TypeCode) = 'VAT']" mode="svrl" priority="149">
  <xsl:if test="not(not(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SellerTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID = 'VA']) and not (/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SellerTaxRepresentativeTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID = 'VA']) and not (//ram:BuyerTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID = 'VA']))">
    <svrl:failed-assert id="BR-O-04" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-O-04]-An Invoice that contains a Document level charge (BG-21) where the Document level charge VAT category code (BT-102) is "Not subject to VAT" shall not contain the Seller VAT identifier (BT-31), the Seller tax representative VAT identifier (BT-63) or the Buyer VAT identifier (BT-48).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:RateApplicablePercent))">
    <svrl:failed-assert id="BR-O-07" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-O-07]-A Document level charge (BG-21) where the VAT category code (BT-102) is "Not subject to VAT" shall not contain a Document level charge VAT rate (BT-103).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax[ram:CategoryCode = 'O'][upper-case(ram:TypeCode) = 'VAT'] [EN16931-CII-Model] -->
<xsl:template match="rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax[ram:CategoryCode = 'O'][upper-case(ram:TypeCode) = 'VAT']" mode="svrl" priority="150">
  <xsl:if test="not(not(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SellerTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID = 'VA']) and not (/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SellerTaxRepresentativeTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID = 'VA']) and not (//ram:BuyerTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID = 'VA']))">
    <svrl:failed-assert id="BR-O-02" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-O-02]-An Invoice that contains an Invoice line (BG-25) where the Invoiced item VAT category code (BT-151) is "Not subject to VAT" shall not contain the Seller VAT identifier (BT-31), the Seller tax representative VAT identifier (BT-63) or the Buyer VAT identifier (BT-48).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:RateApplicablePercent))">
    <svrl:failed-assert id="BR-O-05" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-O-05]-An Invoice line (BG-25) where the VAT category code (BT-151) is "Not subject to VAT" shall not contain an Invoiced item VAT rate (BT-152).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax/ram:CategoryCode[.='S'] [EN16931-CII-Model] -->
<xsl:template match="ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax/ram:CategoryCode[.='S']" mode="svrl" priority="151">
  <xsl:if test="not(every $rate in ../ram:RateApplicablePercent/xs:decimal(.) satisfies (../ram:BasisAmount = (round(sum(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeSettlement[ram:ApplicableTradeTax/ram:CategoryCode = 'S' and ram:ApplicableTradeTax/xs:decimal(ram:RateApplicablePercent) =$rate]/ram:SpecifiedTradeSettlementLineMonetarySummation/xs:decimal(ram:LineTotalAmount)) * 10 * 10) div 100 + round(sum(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator=true() and ram:CategoryTradeTax/ram:CategoryCode='S' and ram:CategoryTradeTax/xs:decimal(ram:RateApplicablePercent)=$rate]/xs:decimal(ram:ActualAmount[1])) * 10 * 10) div 100 - round(sum(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator=false() and ram:CategoryTradeTax/ram:CategoryCode='S' and ram:CategoryTradeTax/xs:decimal(ram:RateApplicablePercent)=$rate]/xs:decimal(ram:ActualAmount[1])) * 10 * 10) div 100)))">
    <svrl:failed-assert id="BR-S-08" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-S-08]-For each different value of VAT category rate (BT-119) where the VAT category code (BT-118) is "Standard rated", the VAT category taxable amount (BT-116) in a VAT breakdown (BG-23) shall equal the sum of Invoice line net amounts (BT-131) plus the sum of document level charge amounts (BT-99) minus the sum of document level allowance amounts (BT-92) where the VAT category code (BT-151, BT-102, BT-95) is "Standard rated" and the VAT rate (BT-152, BT-103, BT-96) equals the VAT category rate (BT-119).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not((abs(xs:decimal(../ram:CalculatedAmount)) - 1 < round(abs(xs:decimal(../ram:BasisAmount)) * ../ram:RateApplicablePercent) div 100 ) and (abs(xs:decimal(../ram:CalculatedAmount)) + 1 > round(abs(xs:decimal(../ram:BasisAmount)) * ../ram:RateApplicablePercent) div 100 ))">
    <svrl:failed-assert id="BR-S-09" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-S-09]-The VAT category tax amount (BT-117) in a VAT breakdown (BG-23) where VAT category code (BT-118) is "Standard rated" shall equal the VAT category taxable amount (BT-116) multiplied by the VAT category rate (BT-119).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(../ram:ExemptionReason) and not (../ram:ExemptionReasonCode))">
    <svrl:failed-assert id="BR-S-10" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-S-10]-A VAT Breakdown (BG-23) with VAT Category code (BT-118) "Standard rate" shall not have a VAT exemption reason code (BT-121) or VAT exemption reason text (BT-120).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax[ram:CategoryCode = 'S'][upper-case(ram:TypeCode) = 'VAT'] [EN16931-CII-Model] -->
<xsl:template match="rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax[ram:CategoryCode = 'S'][upper-case(ram:TypeCode) = 'VAT']" mode="svrl" priority="152">
  <xsl:if test="not(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SellerTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID = ('VA', 'FC')] or /rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SellerTaxRepresentativeTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID = 'VA'])">
    <svrl:failed-assert id="BR-S-02" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-S-02]-An Invoice that contains an Invoice line (BG-25) where the Invoiced item VAT category code (BT-151) is "Standard rated" shall contain the Seller VAT Identifier (BT-31), the Seller tax registration identifier (BT-32) and/or the Seller tax representative VAT identifier (BT-63).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(ram:RateApplicablePercent > 0)">
    <svrl:failed-assert id="BR-S-05" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-S-05]-In an Invoice line (BG-25) where the Invoiced item VAT category code (BT-151) is "Standard rated" the Invoiced item VAT rate (BT-152) shall be greater than zero.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator=false()]/ram:CategoryTradeTax[ram:CategoryCode = 'S'][upper-case(ram:TypeCode) = 'VAT'] [EN16931-CII-Model] -->
<xsl:template match="ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator=false()]/ram:CategoryTradeTax[ram:CategoryCode = 'S'][upper-case(ram:TypeCode) = 'VAT']" mode="svrl" priority="153">
  <xsl:if test="not(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SellerTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID = ('VA', 'FC')] or /rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SellerTaxRepresentativeTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID = 'VA'])">
    <svrl:failed-assert id="BR-S-03" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-S-03]-An Invoice that contains a Document level allowance (BG-20) where the Document level allowance VAT category code (BT-95) is "Standard rated" shall contain the Seller VAT Identifier (BT-31), the Seller tax registration identifier (BT-32) and/or the Seller tax representative VAT identifier (BT-63).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(ram:RateApplicablePercent > 0)">
    <svrl:failed-assert id="BR-S-06" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-S-06]-In a Document level allowance (BG-20) where the Document level allowance VAT category code (BT-95) is "Standard rated" the Document level allowance VAT rate (BT-96) shall be greater than zero.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator=true()]/ram:CategoryTradeTax[ram:CategoryCode = 'S'][upper-case(ram:TypeCode) = 'VAT'] [EN16931-CII-Model] -->
<xsl:template match="ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator=true()]/ram:CategoryTradeTax[ram:CategoryCode = 'S'][upper-case(ram:TypeCode) = 'VAT']" mode="svrl" priority="154">
  <xsl:if test="not(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SellerTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID = ('VA', 'FC')] or /rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SellerTaxRepresentativeTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID = 'VA'])">
    <svrl:failed-assert id="BR-S-04" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-S-04]-An Invoice that contains a Document level charge (BG-21) where the Document level charge VAT category code (BT-102) is "Standard rated" shall contain the Seller VAT Identifier (BT-31), the Seller tax registration identifier (BT-32) and/or the Seller tax representative VAT identifier (BT-63).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(ram:RateApplicablePercent > 0)">
    <svrl:failed-assert id="BR-S-07" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-S-07]-In a Document level charge (BG-21) where the Document level charge VAT category code (BT-102) is "Standard rated" the Document level charge VAT rate (BT-103) shall be greater than zero.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax/ram:CategoryCode[. = 'Z'] [EN16931-CII-Model] -->
<xsl:template match="ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax/ram:CategoryCode[. = 'Z']" mode="svrl" priority="155">
  <xsl:if test="not((../ram:BasisAmount -1 < (round(sum(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeSettlement[ram:ApplicableTradeTax/ram:CategoryCode = 'Z']/ram:SpecifiedTradeSettlementLineMonetarySummation/xs:decimal(ram:LineTotalAmount))*10*10)div 100) + (round(sum(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeAllowanceCharge[(ram:ChargeIndicator/udt:Indicator cast as xs:boolean)=true() and ram:CategoryTradeTax/ram:CategoryCode='Z']/xs:decimal(ram:ActualAmount[1]))*10*10)div 100) - (round(sum(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeAllowanceCharge[(ram:ChargeIndicator/udt:Indicator cast as xs:boolean)=false() and ram:CategoryTradeTax/ram:CategoryCode='Z']/xs:decimal(ram:ActualAmount[1]))*10*10)div 100)) and (../ram:BasisAmount +1 > (round(sum(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeSettlement[ram:ApplicableTradeTax/ram:CategoryCode = 'Z']/ram:SpecifiedTradeSettlementLineMonetarySummation/xs:decimal(ram:LineTotalAmount))*10*10)div 100) + (round(sum(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeAllowanceCharge[(ram:ChargeIndicator/udt:Indicator cast as xs:boolean)=true() and ram:CategoryTradeTax/ram:CategoryCode='Z']/xs:decimal(ram:ActualAmount[1]))*10*10)div 100) - (round(sum(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeAllowanceCharge[(ram:ChargeIndicator/udt:Indicator cast as xs:boolean)=false() and ram:CategoryTradeTax/ram:CategoryCode='Z']/xs:decimal(ram:ActualAmount[1]))*10*10)div 100)))">
    <svrl:failed-assert id="BR-Z-08" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-Z-08]-In a VAT breakdown (BG-23) where VAT category code (BT-118) is "Zero rated" the VAT category taxable amount (BT-116) shall equal the sum of Invoice line net amount (BT-131) minus the sum of Document level allowance amounts (BT-92) plus the sum of Document level charge amounts (BT-99) where the VAT category codes (BT-151, BT-95, BT-102) are "Zero rated".</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(../ram:CalculatedAmount = 0)">
    <svrl:failed-assert id="BR-Z-09" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-Z-09]-The VAT category tax amount (BT-117) in a VAT breakdown (BG-23) where VAT category code (BT-118) is "Zero rated" shall equal 0 (zero).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(../ram:ExemptionReason) and not (../ram:ExemptionReasonCode))">
    <svrl:failed-assert id="BR-Z-10" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-Z-10]-A VAT Breakdown (BG-23) with VAT Category code (BT-118) "Zero rated" shall not have a VAT exemption reason code (BT-121) or VAT exemption reason text (BT-120).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator=false()]/ram:CategoryTradeTax[ram:CategoryCode = 'Z'][upper-case(ram:TypeCode) = 'VAT'] [EN16931-CII-Model] -->
<xsl:template match="ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator=false()]/ram:CategoryTradeTax[ram:CategoryCode = 'Z'][upper-case(ram:TypeCode) = 'VAT']" mode="svrl" priority="156">
  <xsl:if test="not(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SellerTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID = ('VA', 'FC')] or /rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SellerTaxRepresentativeTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID = 'VA'])">
    <svrl:failed-assert id="BR-Z-03" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-Z-03]-An Invoice that contains a Document level allowance (BG-20) where the Document level allowance VAT category code (BT-95) is "Zero rated" shall contain the Seller VAT Identifier (BT-31), the Seller tax registration identifier (BT-32) and/or the Seller tax representative VAT identifier (BT-63).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(ram:RateApplicablePercent = 0)">
    <svrl:failed-assert id="BR-Z-06" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-Z-06]-In a Document level allowance (BG-20) where the Document level allowance VAT category code (BT-95) is "Zero rated" the Document level allowance VAT rate (BT-96) shall be 0 (zero).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator=true()]/ram:CategoryTradeTax[ram:CategoryCode = 'Z'][upper-case(ram:TypeCode) = 'VAT'] [EN16931-CII-Model] -->
<xsl:template match="ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator=true()]/ram:CategoryTradeTax[ram:CategoryCode = 'Z'][upper-case(ram:TypeCode) = 'VAT']" mode="svrl" priority="157">
  <xsl:if test="not(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SellerTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID = ('VA', 'FC')] or /rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SellerTaxRepresentativeTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID = 'VA'])">
    <svrl:failed-assert id="BR-Z-04" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-Z-04]-An Invoice that contains a Document level charge where the Document level charge VAT category code (BT-102) is "Zero rated" shall contain the Seller VAT Identifier (BT-31), the Seller tax registration identifier (BT-32) and/or the Seller tax representative VAT identifier (BT-63).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(ram:RateApplicablePercent = 0)">
    <svrl:failed-assert id="BR-Z-07" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-Z-07]-In a Document level charge (BG-21) where the Document level charge VAT category code (BT-102) is "Zero rated" the Document level charge VAT rate (BT-103) shall be 0 (zero).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax[ram:CategoryCode = 'Z'][upper-case(ram:TypeCode) = 'VAT'] [EN16931-CII-Model] -->
<xsl:template match="rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax[ram:CategoryCode = 'Z'][upper-case(ram:TypeCode) = 'VAT']" mode="svrl" priority="158">
  <xsl:if test="not(/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SellerTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID = ('VA', 'FC')] or /rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:SellerTaxRepresentativeTradeParty/ram:SpecifiedTaxRegistration/ram:ID[@schemeID = 'VA'])">
    <svrl:failed-assert id="BR-Z-02" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-Z-02]-An Invoice that contains an Invoice line where the Invoiced item VAT category code (BT-151) is "Zero rated" shall contain the Seller VAT Identifier (BT-31), the Seller tax registration identifier (BT-32) and/or the Seller tax representative VAT identifier (BT-63).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(ram:RateApplicablePercent = 0)">
    <svrl:failed-assert id="BR-Z-05" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-Z-05]-In an Invoice line (BG-25) where the Invoiced item VAT category code (BT-151) is "Zero rated" the Invoiced item VAT rate (BT-152) shall be 0 (zero).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax [EN16931-CII-Model] -->
<xsl:template match="ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax" mode="svrl" priority="159">
  <xsl:if test="not((ram:BasisAmount))">
    <svrl:failed-assert id="BR-45" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-45]-Each VAT breakdown (BG-23) shall have a VAT category taxable amount (BT-116).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not((ram:CalculatedAmount))">
    <svrl:failed-assert id="BR-46" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-46]-Each VAT breakdown (BG-23) shall have a VAT category tax amount (BT-117).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not((.[upper-case(ram:TypeCode) = 'VAT']/ram:CategoryCode))">
    <svrl:failed-assert id="BR-47" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-47]-Each VAT breakdown (BG-23) shall be defined through a VAT category code (BT-118).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not((.[upper-case(ram:TypeCode) = 'VAT']/ram:RateApplicablePercent) or (.[upper-case(ram:TypeCode) = 'VAT']/ram:CategoryCode = 'O'))">
    <svrl:failed-assert id="BR-48" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-48]-Each VAT breakdown (BG-23) shall have a VAT category rate (BT-119), except if the Invoice is not subject to VAT.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(((//ram:TaxPointDate) and not(//ram:DueDateTypeCode)) or (not (//ram:TaxPointDate) and (//ram:DueDateTypeCode)) or (not (//ram:TaxPointDate) and not (//ram:DueDateTypeCode)))">
    <svrl:failed-assert id="BR-CO-03" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-CO-03]-Value added tax point date (BT-7) and Value added tax point date code (BT-8) are mutually exclusive.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not((round(.[normalize-space(upper-case(ram:TypeCode)) = 'VAT']/xs:decimal(ram:RateApplicablePercent)) = 0 and (round(xs:decimal(ram:CalculatedAmount)) = 0)) or (round(.[normalize-space(upper-case(ram:TypeCode)) = 'VAT']/xs:decimal(ram:RateApplicablePercent)) != 0 and ((abs(xs:decimal(ram:CalculatedAmount)) - 1 <= round(abs(xs:decimal(ram:BasisAmount)) * (.[normalize-space(upper-case(ram:TypeCode)) = 'VAT']/xs:decimal(ram:RateApplicablePercent) div 100) * 10 * 10) div 100 ) and (abs(xs:decimal(ram:CalculatedAmount)) + 1 >= round(abs(xs:decimal(ram:BasisAmount)) * (.[normalize-space(upper-case(ram:TypeCode)) = 'VAT']/xs:decimal(ram:RateApplicablePercent) div 100) * 10 * 10) div 100 ))) or (not(exists(.[normalize-space(upper-case(ram:TypeCode))='VAT']/xs:decimal(ram:RateApplicablePercent))) and (round(xs:decimal(ram:CalculatedAmount)) = 0)))">
    <svrl:failed-assert id="BR-CO-17" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-CO-17]-VAT category tax amount (BT-117) = VAT category taxable amount (BT-116) x (VAT category rate (BT-119) / 100), rounded to two decimals.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(string-length(substring-after(ram:BasisAmount,'.'))<=2)">
    <svrl:failed-assert id="BR-DEC-19" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-DEC-19]-The allowed maximum number of decimals for the VAT category taxable amount (BT-116) is 2.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(string-length(substring-after(ram:CalculatedAmount,'.'))<=2)">
    <svrl:failed-assert id="BR-DEC-20" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-DEC-20]-The allowed maximum number of decimals for the VAT category tax amount (BT-117) is 2.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: /rsm:CrossIndustryInvoice/rsm:ExchangedDocumentContext [EN16931-CII-Syntax] -->
<xsl:template match="/rsm:CrossIndustryInvoice/rsm:ExchangedDocumentContext" mode="svrl" priority="160">
  <xsl:if test="not(not(ram:SpecifiedTransactionID))">
    <svrl:failed-assert id="CII-SR-001" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-001] - SpecifiedTransactionID should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:TestIndicator))">
    <svrl:failed-assert id="CII-SR-002" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-002] - TestIndicator should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not((count(ram:BusinessProcessSpecifiedDocumentContextParameter) <= 1))">
    <svrl:failed-assert id="CII-SR-003" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-003] - BusinessProcessSpecifiedDocumentContextParameter should exist maximum once</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:BIMSpecifiedDocumentContextParameter))">
    <svrl:failed-assert id="CII-SR-006" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-006] - BIMSpecifiedDocumentContextParameter should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ScenarioSpecifiedDocumentContextParameter))">
    <svrl:failed-assert id="CII-SR-007" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-007] - ScenarioSpecifiedDocumentContextParameter should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ApplicationSpecifiedDocumentContextParameter))">
    <svrl:failed-assert id="CII-SR-008" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-008] - ApplicationSpecifiedDocumentContextParameter should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(count(ram:GuidelineSpecifiedDocumentContextParameter) = 1)">
    <svrl:failed-assert id="CII-SR-009" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-SR-009] - GuidelineSpecifiedDocumentContextParameter must exist exactly once</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(count(ram:GuidelineSpecifiedDocumentContextParameter/ram:ID) = 1)">
    <svrl:failed-assert id="CII-SR-010" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-SR-010] - ID must exist exactly once</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SubsetSpecifiedDocumentContextParameter))">
    <svrl:failed-assert id="CII-SR-011" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-011] - SubsetSpecifiedDocumentContextParameter should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:MessageStandardSpecifiedDocumentContextParameter))">
    <svrl:failed-assert id="CII-SR-012" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-012] - MessageStandardSpecifiedDocumentContextParameter should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: /rsm:CrossIndustryInvoice/rsm:ExchangedDocument [EN16931-CII-Syntax] -->
<xsl:template match="/rsm:CrossIndustryInvoice/rsm:ExchangedDocument" mode="svrl" priority="161">
  <xsl:if test="not(not(ram:Name))">
    <svrl:failed-assert id="CII-SR-013" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-013] - Name should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(count(ram:TypeCode) = 1)">
    <svrl:failed-assert id="CII-SR-014" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-SR-014] - TypeCode must exist exactly once</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:IssueDateTime/udt:DateTime))">
    <svrl:failed-assert id="CII-SR-015" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-015] - DateTime should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:CopyIndicator))">
    <svrl:failed-assert id="CII-SR-016" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-016] - CopyIndicator should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:Purpose))">
    <svrl:failed-assert id="CII-SR-017" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-017] - Purpose should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ControlRequirementIndicator))">
    <svrl:failed-assert id="CII-SR-018" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-018] - ControlRequirementIndicator should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:LanguageID))">
    <svrl:failed-assert id="CII-SR-019" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-019] - LanguageID should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:PurposeCode))">
    <svrl:failed-assert id="CII-SR-020" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-020] - PurposeCode should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:RevisionDateTime))">
    <svrl:failed-assert id="CII-SR-021" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-021] - RevisionDateTime should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:VersionID))">
    <svrl:failed-assert id="CII-SR-022" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-022] - VersionID should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:GlobalID))">
    <svrl:failed-assert id="CII-SR-023" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-023] - GlobalID should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:RevisionID))">
    <svrl:failed-assert id="CII-SR-024" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-024] - RevisionID should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:PreviousRevisionID))">
    <svrl:failed-assert id="CII-SR-025" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-025] - PreviousRevisionID should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:CategoryCode))">
    <svrl:failed-assert id="CII-SR-026" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-026] - CategoryCode should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:IncludedNote/ram:Subject))">
    <svrl:failed-assert id="CII-SR-027" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-027] - Subject should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:IncludedNote/ram:ContentCode))">
    <svrl:failed-assert id="CII-SR-028" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-028] - ContentCode should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:IncludedNote/ram:ID))">
    <svrl:failed-assert id="CII-SR-032" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-032] - ID should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:EffectiveSpecifiedPeriod))">
    <svrl:failed-assert id="CII-SR-033" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-033] - EffectiveSpecifiedPeriod should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:IssuerTradeParty))">
    <svrl:failed-assert id="CII-SR-034" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-034] - IssuerTradeParty should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: /rsm:CrossIndustryInvoice/rsm:ExchangedDocument/ram:IncludedNote [EN16931-CII-Syntax] -->
<xsl:template match="/rsm:CrossIndustryInvoice/rsm:ExchangedDocument/ram:IncludedNote" mode="svrl" priority="162">
  <xsl:if test="not(count(ram:Content) <= 1)">
    <svrl:failed-assert id="CII-SR-030" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-030] - Content should exist maximum once</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: /rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem [EN16931-CII-Syntax] -->
<xsl:template match="/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem" mode="svrl" priority="163">
  <xsl:if test="not(not(ram:DescriptionCode))">
    <svrl:failed-assert id="CII-SR-035" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-035] - DescriptionCode should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ParentLineID))">
    <svrl:failed-assert id="CII-SR-036" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-036] - ParentLineID should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:LineStatusCode))">
    <svrl:failed-assert id="CII-SR-037" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-037] - LineStatusCode should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:LineStatusReasonCode))">
    <svrl:failed-assert id="CII-SR-038" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-038] - LineStatusReasonCode should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:IncludedSubordinateTradeLineItem))">
    <svrl:failed-assert id="CII-SR-221" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-221] - IncludedSubordinateTradeLineItem should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: /rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem/ram:AssociatedDocumentLineDocument [EN16931-CII-Syntax] -->
<xsl:template match="/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem/ram:AssociatedDocumentLineDocument" mode="svrl" priority="164">
  <xsl:if test="not(count(ram:IncludedNote) <= 1)">
    <svrl:failed-assert id="CII-SR-039" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-039] - IncludedNote should exist maximum once</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(count(ram:IncludedNote/ram:Content) <= 1)">
    <svrl:failed-assert id="CII-SR-040" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-040] - Content should exist maximum once</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:IncludedNote/ram:SubjectCode))">
    <svrl:failed-assert id="CII-SR-041" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-041] - SubjectCode should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:IncludedNote/ram:ID))">
    <svrl:failed-assert id="CII-SR-042" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-042] - ID should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:IncludedNote/ram:Subject))">
    <svrl:failed-assert id="CII-SR-043" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-043] - CategoryCode should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:IncludedNote/ram:ContentCode))">
    <svrl:failed-assert id="CII-SR-044" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-044] - Subject should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: /rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedTradeProduct [EN16931-CII-Syntax] -->
<xsl:template match="/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedTradeProduct" mode="svrl" priority="165">
  <xsl:if test="not(not(ram:ID))">
    <svrl:failed-assert id="CII-SR-045" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-045] - ID should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:GlobalID) or (ram:GlobalID/@schemeID))">
    <svrl:failed-assert id="CII-SR-046" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-SR-046] - schemeID must be present if GlobalID is present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ManufacturerAssignedID))">
    <svrl:failed-assert id="CII-SR-048" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-048] - ManufacturerAssignedID should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:TradeName))">
    <svrl:failed-assert id="CII-SR-049" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-049] - TradeName should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:TypeCode))">
    <svrl:failed-assert id="CII-SR-050" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-050] - TypeCode should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:NetWeightMeasure))">
    <svrl:failed-assert id="CII-SR-051" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-051] - NetWeightMeasure should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:GrossWeightMeasure))">
    <svrl:failed-assert id="CII-SR-052" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-052] - GrossWeightMeasure should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ProductGroupID))">
    <svrl:failed-assert id="CII-SR-053" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-053] - ProductGroupID should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:EndItemTypeCode))">
    <svrl:failed-assert id="CII-SR-054" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-054] - EndItemTypeCode should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:EndItemName))">
    <svrl:failed-assert id="CII-SR-055" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-055] - EndItemName should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:AreaDensityMeasure))">
    <svrl:failed-assert id="CII-SR-056" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-056] - AreaDensityMeasure should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:UseDescription))">
    <svrl:failed-assert id="CII-SR-057" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-057] - UseDescription should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:BrandName))">
    <svrl:failed-assert id="CII-SR-058" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-058] - BrandName should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SubBrandName))">
    <svrl:failed-assert id="CII-SR-059" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-059] - SubBrandName should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:DrainedNetWeightMeasure))">
    <svrl:failed-assert id="CII-SR-060" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-060] - DrainedNetWeightMeasure should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:VariableMeasureIndicator))">
    <svrl:failed-assert id="CII-SR-061" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-061] - VariableMeasureIndicator should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ColourCode))">
    <svrl:failed-assert id="CII-SR-062" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-062] - ColourCode should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ColourDescription))">
    <svrl:failed-assert id="CII-SR-063" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-063] - ColourDescription should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:Designation))">
    <svrl:failed-assert id="CII-SR-064" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-064] - Designation should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:FormattedCancellationAnnouncedLaunchDateTime))">
    <svrl:failed-assert id="CII-SR-065" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-065] - FormattedCancellationAnnouncedLaunchDateTime should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:FormattedLatestProductDataChangeDateTime))">
    <svrl:failed-assert id="CII-SR-066" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-066] - FormattedLatestProductDataChangeDateTime should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ApplicableProductCharacteristic/ram:ID))">
    <svrl:failed-assert id="CII-SR-067" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-067] - ID should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ApplicableProductCharacteristic/ram:TypeCode))">
    <svrl:failed-assert id="CII-SR-068" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-068] - TypeCode should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ApplicableProductCharacteristic/ram:ValueMeasure))">
    <svrl:failed-assert id="CII-SR-070" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-070] - ValueMeasure should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ApplicableProductCharacteristic/ram:MeasurementMethodCode))">
    <svrl:failed-assert id="CII-SR-071" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-071] - MeasurementMethodCode should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ApplicableProductCharacteristic/ram:ValueCode))">
    <svrl:failed-assert id="CII-SR-073" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-073] - ValueCode should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ApplicableProductCharacteristic/ram:ValueDateTime))">
    <svrl:failed-assert id="CII-SR-074" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-074] - ValueDateTime should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ApplicableProductCharacteristic/ram:ValueIndicator))">
    <svrl:failed-assert id="CII-SR-075" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-075] - ValueIndicator should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ApplicableProductCharacteristic/ram:ContentTypeCode))">
    <svrl:failed-assert id="CII-SR-076" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-076] - ContentTypeCode should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ApplicableProductCharacteristic/ram:ValueSpecifiedBinaryFile))">
    <svrl:failed-assert id="CII-SR-077" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-077] - ValueSpecifiedBinaryFile should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ApplicableProductCharacteristic/ram:ApplicableProductCharacteristicCondition))">
    <svrl:failed-assert id="CII-SR-078" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-078] - ApplicableProductCharacteristicCondition should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ApplicableProductCharacteristic/ram:ApplicableReferencedStandard))">
    <svrl:failed-assert id="CII-SR-079" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-079] - ApplicableReferencedStandard should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ApplicableMaterialGoodsCharacteristic))">
    <svrl:failed-assert id="CII-SR-080" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-080] - ApplicableMaterialGoodsCharacteristic should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:DesignatedProductClassification/ram:SystemID))">
    <svrl:failed-assert id="CII-SR-081" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-081] - SystemID should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:DesignatedProductClassification/ram:SystemName))">
    <svrl:failed-assert id="CII-SR-082" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-082] - SystemName should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:DesignatedProductClassification/ram:ClassName))">
    <svrl:failed-assert id="CII-SR-083" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-083] - ClassName should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:DesignatedProductClassification/ram:SubClassCode))">
    <svrl:failed-assert id="CII-SR-084" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-084] - SubClassCode should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:DesignatedProductClassification/ram:ClassProductCharacteristic))">
    <svrl:failed-assert id="CII-SR-085" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-085] - ClassProductCharacteristic should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:DesignatedProductClassification/ram:ApplicableReferencedStandard))">
    <svrl:failed-assert id="CII-SR-086" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-086] - ApplicableReferencedStandard should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:IndividualTradeProductInstance))">
    <svrl:failed-assert id="CII-SR-087" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-087] - IndividualTradeProductInstance should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:CertificationEvidenceReferenceReferencedDocument))">
    <svrl:failed-assert id="CII-SR-088" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-088] - CertificationEvidenceReferenceReferencedDocument should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:InspectionReferenceReferencedDocument))">
    <svrl:failed-assert id="CII-SR-089" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-089] - InspectionReferenceReferencedDocument should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not (ram:OriginTradeCountry) or (count(ram:OriginTradeCountry/ram:ID) =1))">
    <svrl:failed-assert id="CII-SR-090" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-SR-090] - ID should exist maximum once.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:OriginTradeCountry/ram:Name))">
    <svrl:failed-assert id="CII-SR-091" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-091] - Name should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:OriginTradeCountry/ram:SubordinateTradeCountrySubDivision))">
    <svrl:failed-assert id="CII-SR-092" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-092] - SubordinateTradeCountrySubDivision should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:LinearSpatialDimension))">
    <svrl:failed-assert id="CII-SR-093" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-093] - LinearSpatialDimension should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:MinimumLinearSpatialDimension))">
    <svrl:failed-assert id="CII-SR-094" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-094] - MinimumLinearSpatialDimension should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:MaximumLinearSpatialDimension))">
    <svrl:failed-assert id="CII-SR-095" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-095] - MaximumLinearSpatialDimension should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ManufacturerTradeParty))">
    <svrl:failed-assert id="CII-SR-096" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-096] - ManufacturerTradeParty should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:PresentationSpecifiedBinaryFile))">
    <svrl:failed-assert id="CII-SR-097" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-097] - PresentationSpecifiedBinaryFile should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:MSDSReferenceReferencedDocument))">
    <svrl:failed-assert id="CII-SR-098" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-098] - MSDSReferenceReferencedDocument should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:AdditionalReferenceReferencedDocument))">
    <svrl:failed-assert id="CII-SR-099" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-099] - AdditionalReferenceReferencedDocument should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:LegalRightsOwnerTradeParty))">
    <svrl:failed-assert id="CII-SR-100" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-100] - LegalRightsOwnerTradeParty should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:BrandOwnerTradeParty))">
    <svrl:failed-assert id="CII-SR-101" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-101] -BrandOwnerTradeParty should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:IncludedReferencedProduct))">
    <svrl:failed-assert id="CII-SR-102" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-102] -IncludedReferencedProduct should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:InformationNote))">
    <svrl:failed-assert id="CII-SR-103" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-103] - InformationNoteshould not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: /rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedTradeProduct/ram:ApplicableProductCharacteristic [EN16931-CII-Syntax] -->
<xsl:template match="/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedTradeProduct/ram:ApplicableProductCharacteristic" mode="svrl" priority="166">
  <xsl:if test="not((count(ram:Description) =1))">
    <svrl:failed-assert id="CII-SR-069" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-SR-069] - Description should exist maximum once.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not((count(ram:Value) =1))">
    <svrl:failed-assert id="CII-SR-072" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-SR-072] - Value should exist maximum once.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: /rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeAgreement [EN16931-CII-Syntax] -->
<xsl:template match="/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeAgreement" mode="svrl" priority="167">
  <xsl:if test="not(not(ram:BuyerReference))">
    <svrl:failed-assert id="CII-SR-104" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-104] - BuyerReference should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:BuyerRequisitionerTradeParty))">
    <svrl:failed-assert id="CII-SR-105" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-105] - BuyerRequisitionerTradeParty should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ApplicableTradeDeliveryTerms))">
    <svrl:failed-assert id="CII-SR-106" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-106] - ApplicableTradeDeliveryTerms should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SellerOrderReferencedDocument))">
    <svrl:failed-assert id="CII-SR-107" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-107] - SellerOrderReferencedDocument should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:BuyerOrderReferencedDocument/ram:IssuerAssignedID))">
    <svrl:failed-assert id="CII-SR-108" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-108] - IssuerAssignedID should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:QuotationReferencedDocument))">
    <svrl:failed-assert id="CII-SR-109" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-109] - QuotationReferencedDocument should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ContractReferencedDocument))">
    <svrl:failed-assert id="CII-SR-110" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-110] - ContractReferencedDocument should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:DemandForecastReferencedDocument))">
    <svrl:failed-assert id="CII-SR-111" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-111] - DemandForecastReferencedDocument should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:PromotionalDealReferencedDocument))">
    <svrl:failed-assert id="CII-SR-112" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-112] - PromotionalDealReferencedDocument should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:AdditionalReferencedDocument))">
    <svrl:failed-assert id="CII-SR-113" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-113] - AdditionalReferencedDocument should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:GrossPriceProductTradePrice/ram:TypeCode))">
    <svrl:failed-assert id="CII-SR-114" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-114] - TypeCode should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:GrossPriceProductTradePrice/ram:MinimumQuantity))">
    <svrl:failed-assert id="CII-SR-115" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-115] - MinimumQuantity should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:GrossPriceProductTradePrice/ram:MaximumQuantity))">
    <svrl:failed-assert id="CII-SR-116" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-116] - MaximumQuantity should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:GrossPriceProductTradePrice/ram:ChangeReason))">
    <svrl:failed-assert id="CII-SR-117" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-117] - ChangeReason should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:GrossPriceProductTradePrice/ram:OrderUnitConversionFactorNumeric))">
    <svrl:failed-assert id="CII-SR-118" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-118] - OrderUnitConversionFactorNumeric should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(count(ram:NetPriceProductTradePrice/ram:ChargeAmount) = 1)">
    <svrl:failed-assert id="CII-SR-439" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-SR-439] - ChargeAmount should exist maximum once</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not((ram:GrossPriceProductTradePrice/ram:AppliedTradeAllowanceCharge/ram:ChargeIndicator[udt:Indicator=false()] and ram:GrossPriceProductTradePrice/ram:AppliedTradeAllowanceCharge/ram:ActualAmount) or (not (ram:GrossPriceProductTradePrice/ram:AppliedTradeAllowanceCharge/ram:ChargeIndicator) and not (ram:GrossPriceProductTradePrice/ram:AppliedTradeAllowanceCharge/ram:ActualAmount)))">
    <svrl:failed-assert id="CII-SR-119" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-119] - Only allowances on price a price should be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:GrossPriceProductTradePrice/ram:AppliedTradeAllowanceCharge/ram:ID))">
    <svrl:failed-assert id="CII-SR-120" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-120] - ID should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:GrossPriceProductTradePrice/ram:AppliedTradeAllowanceCharge/ram:SequenceNumeric))">
    <svrl:failed-assert id="CII-SR-121" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-121] - SequenceNumeric should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:GrossPriceProductTradePrice/ram:AppliedTradeAllowanceCharge/ram:CalculationPercent))">
    <svrl:failed-assert id="CII-SR-122" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-122] - CalculationPercent should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:GrossPriceProductTradePrice/ram:AppliedTradeAllowanceCharge/ram:BasisAmount))">
    <svrl:failed-assert id="CII-SR-123" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-123] - BasisAmount should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:GrossPriceProductTradePrice/ram:AppliedTradeAllowanceCharge/ram:BasisQuantity))">
    <svrl:failed-assert id="CII-SR-124" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-124] - BasisQuantity should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:GrossPriceProductTradePrice/ram:AppliedTradeAllowanceCharge/ram:PrepaidIndicator))">
    <svrl:failed-assert id="CII-SR-125" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-125] - PrepaidIndicator should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:GrossPriceProductTradePrice/ram:AppliedTradeAllowanceCharge/ram:UnitBasisAmount))">
    <svrl:failed-assert id="CII-SR-126" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-126] - UnitBasisAmount should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:GrossPriceProductTradePrice/ram:AppliedTradeAllowanceCharge/ram:ReasonCode))">
    <svrl:failed-assert id="CII-SR-127" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-127] - ReasonCode should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:GrossPriceProductTradePrice/ram:AppliedTradeAllowanceCharge/ram:Reason))">
    <svrl:failed-assert id="CII-SR-128" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-128] - Reason should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:GrossPriceProductTradePrice/ram:AppliedTradeAllowanceCharge/ram:TypeCode))">
    <svrl:failed-assert id="CII-SR-129" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-129] - TypeCode should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:GrossPriceProductTradePrice/ram:AppliedTradeAllowanceCharge/ram:CategoryTradeTax))">
    <svrl:failed-assert id="CII-SR-130" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-130] - CategoryTradeTax should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:GrossPriceProductTradePrice/ram:AppliedTradeAllowanceCharge/ram:ActualTradeCurrencyExchange))">
    <svrl:failed-assert id="CII-SR-131" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-131] - ActualTradeCurrencyExchange should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:GrossPriceProductTradePrice/ram:IncludedTradeTax))">
    <svrl:failed-assert id="CII-SR-445" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-445] - IncludedTradeTax should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:GrossPriceProductTradePrice/ram:ValiditySpecifiedPeriod))">
    <svrl:failed-assert id="CII-SR-132" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-132] - ValiditySpecifiedPeriod should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:GrossPriceProductTradePrice/ram:DeliveryTradeLocation))">
    <svrl:failed-assert id="CII-SR-133" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-133] - DeliveryTradeLocation should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:GrossPriceProductTradePrice/ram:TradeComparisonReferencePrice))">
    <svrl:failed-assert id="CII-SR-134" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-134] - TradeComparisonReferencePrice should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:GrossPriceProductTradePrice/ram:AssociatedReferencedDocument))">
    <svrl:failed-assert id="CII-SR-135" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-135] - AssociatedReferencedDocument should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:NetPriceProductTradePrice/ram:TypeCode))">
    <svrl:failed-assert id="CII-SR-136" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-136] - TypeCode should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:NetPriceProductTradePrice/ram:MinimumQuantity))">
    <svrl:failed-assert id="CII-SR-138" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-138] - MinimumQuantity should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:NetPriceProductTradePrice/ram:MaximumQuantity))">
    <svrl:failed-assert id="CII-SR-139" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-139] - MaximumQuantity should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:NetPriceProductTradePrice/ram:ChangeReason))">
    <svrl:failed-assert id="CII-SR-140" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-140] - ChangeReason should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:NetPriceProductTradePrice/ram:OrderUnitConversionFactorNumeric))">
    <svrl:failed-assert id="CII-SR-141" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-141] - OrderUnitConversionFactorNumeric should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:NetPriceProductTradePrice/ram:AppliedTradeAllowanceCharge))">
    <svrl:failed-assert id="CII-SR-142" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-142] - AppliedTradeAllowanceCharge should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:NetPriceProductTradePrice/ram:IncludedTradeTax))">
    <svrl:failed-assert id="CII-SR-446" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-446] - IncludedTradeTax should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:NetPriceProductTradePrice/ram:ValiditySpecifiedPeriod))">
    <svrl:failed-assert id="CII-SR-143" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-143] - ValiditySpecifiedPeriod should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:NetPriceProductTradePrice/ram:DeliveryTradeLocation))">
    <svrl:failed-assert id="CII-SR-144" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-144] - DeliveryTradeLocation should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:NetPriceProductTradePrice/ram:TradeComparisonReferencePrice))">
    <svrl:failed-assert id="CII-SR-145" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-145] - TradeComparisonReferencePrice should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:NetPriceProductTradePrice/ram:AssociatedReferencedDocument))">
    <svrl:failed-assert id="CII-SR-146" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-146] - AssociatedReferencedDocument should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(count(ram:NetPriceProductTradePrice/ram:ChargeAmount) <= 1)">
    <svrl:failed-assert id="CII-SR-441" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-SR-441] - ChargeAmount should exist maximum once</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:RequisitionerReferencedDocument))">
    <svrl:failed-assert id="CII-SR-147" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-147] - RequisitionerReferencedDocument should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ItemSellerTradeParty))">
    <svrl:failed-assert id="CII-SR-148" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-148] - ItemSellerTradeParty should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ItemBuyerTradeParty))">
    <svrl:failed-assert id="CII-SR-149" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-149] - ItemBuyerTradeParty should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:IncludedSpecifiedMarketplace))">
    <svrl:failed-assert id="CII-SR-150" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-150] - IncludedSpecifiedMarketplace should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:UltimateCustomerOrderReferencedDocument))">
    <svrl:failed-assert id="CII-SR-447" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-447] - UltimateCustomerOrderReferencedDocument should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:SpecifiedTradeAllowanceCharge [EN16931-CII-Syntax] -->
<xsl:template match="ram:SpecifiedTradeAllowanceCharge" mode="svrl" priority="168">
  <xsl:if test="not((ram:ChargeIndicator))">
    <svrl:failed-assert id="CII-SR-463" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-SR-463]-Each Specified Trade Allowance Charge (BG-20)(BG-21) shall contain a Charge Indicator.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(count(ram:RateApplicablePercent) <= 1)">
    <svrl:failed-assert id="CII-SR-471" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-SR-471]-Each Specified Trade Allowance Charge (BG-20)(BG-21) shall contain a VAT category code (BT-95).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(count(ram:CategoryTradeTax) <= 1)">
    <svrl:failed-assert id="CII-SR-472" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-SR-472]-Each Specified Trade Allowance Charge (BG-20)(BG-21) should contain a VAT rate (BT-96).</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(count(ram:ActualAmount) <= 1)">
    <svrl:failed-assert id="CII-SR-473" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-SR-473] - ActualAmount should exist maximum once</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:GrossPriceProductTradePrice/ram:AppliedTradeAllowanceCharge [EN16931-CII-Syntax] -->
<xsl:template match="ram:GrossPriceProductTradePrice/ram:AppliedTradeAllowanceCharge" mode="svrl" priority="169">
  <xsl:if test="not(count(ram:ActualAmount) <= 1)">
    <svrl:failed-assert id="CII-SR-440" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-SR-440] - ActualAmount should exist maximum once</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: /rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeDelivery [EN16931-CII-Syntax] -->
<xsl:template match="/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeDelivery" mode="svrl" priority="170">
  <xsl:if test="not(not(ram:RequestedQuantity))">
    <svrl:failed-assert id="CII-SR-151" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-151] - RequestedQuantity should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ReceivedQuantity))">
    <svrl:failed-assert id="CII-SR-152" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-152] - ReceivedQuantity should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ChargeFreeQuantity))">
    <svrl:failed-assert id="CII-SR-153" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-153] - ChargeFreeQuantity should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:PackageQuantity))">
    <svrl:failed-assert id="CII-SR-154" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-154] - PackageQuantity should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ProductUnitQuantity))">
    <svrl:failed-assert id="CII-SR-155" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-155] - ProductUnitQuantity should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:PerPackageUnitQuantity))">
    <svrl:failed-assert id="CII-SR-156" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-156] - PerPackageUnitQuantity should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:NetWeightMeasure))">
    <svrl:failed-assert id="CII-SR-157" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-157] - NetWeightMeasure should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:GrossWeightMeasure))">
    <svrl:failed-assert id="CII-SR-158" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-158] - GrossWeightMeasure should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:TheoreticalWeightMeasure))">
    <svrl:failed-assert id="CII-SR-159" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-159] - TheoreticalWeightMeasure should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:DespatchedQuantity))">
    <svrl:failed-assert id="CII-SR-160" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-160] - DespatchedQuantity should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedDeliveryAdjustment))">
    <svrl:failed-assert id="CII-SR-161" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-161] - SpecifiedDeliveryAdjustment should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:IncludedSupplyChainPackaging))">
    <svrl:failed-assert id="CII-SR-162" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-162] - IncludedSupplyChainPackaging should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:RelatedSupplyChainConsignment))">
    <svrl:failed-assert id="CII-SR-163" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-163] - RelatedSupplyChainConsignment should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ShipToTradeParty))">
    <svrl:failed-assert id="CII-SR-164" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-164] - ShipToTradeParty should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:UltimateShipToTradeParty))">
    <svrl:failed-assert id="CII-SR-165" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-165] - UltimateShipToTradeParty should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ShipFromTradeParty))">
    <svrl:failed-assert id="CII-SR-166" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-166] - ShipFromTradeParty should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ActualDespatchSupplyChainEvent))">
    <svrl:failed-assert id="CII-SR-167" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-167] - ActualDespatchSupplyChainEvent should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ActualPickUpSupplyChainEvent))">
    <svrl:failed-assert id="CII-SR-168" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-168] - ActualPickUpSupplyChainEvent should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:RequestedDeliverySupplyChainEvent))">
    <svrl:failed-assert id="CII-SR-169" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-169] - RequestedDeliverySupplyChainEvent should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ActualDeliverySupplyChainEvent))">
    <svrl:failed-assert id="CII-SR-170" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-170] - ActualDeliverySupplyChainEvent should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ActualReceiptSupplyChainEvent))">
    <svrl:failed-assert id="CII-SR-171" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-171] - ActualReceiptSupplyChainEvent should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:AdditionalReferencedDocument))">
    <svrl:failed-assert id="CII-SR-172" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-172] - AdditionalReferencedDocument should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:DespatchAdviceReferencedDocument))">
    <svrl:failed-assert id="CII-SR-173" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-173] - DespatchAdviceReferencedDocument should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ReceivingAdviceReferencedDocument))">
    <svrl:failed-assert id="CII-SR-174" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-174] - ReceivingAdviceReferencedDocument should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:DeliveryNoteReferencedDocument))">
    <svrl:failed-assert id="CII-SR-175" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-175] - DeliveryNoteReferencedDocument should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ConsumptionReportReferencedDocument))">
    <svrl:failed-assert id="CII-SR-176" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-176] - ConsumptionReportReferencedDocument should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:PackingListReferencedDocument))">
    <svrl:failed-assert id="CII-SR-177" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-177] - RequestedQuantity should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: /rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeSettlement [EN16931-CII-Syntax] -->
<xsl:template match="/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeSettlement" mode="svrl" priority="171">
  <xsl:if test="not(not(ram:PaymentReference))">
    <svrl:failed-assert id="CII-SR-178" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-178] - PaymentReference should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:InvoiceIssuerReference))">
    <svrl:failed-assert id="CII-SR-179" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-179] - InvoiceIssuerReference should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:TotalAdjustmentAmount))">
    <svrl:failed-assert id="CII-SR-180" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-180] - TotalAdjustmentAmount should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:DiscountIndicator))">
    <svrl:failed-assert id="CII-SR-181" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-181] - DiscountIndicator should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ApplicableTradeTax/ram:CalculatedAmount))">
    <svrl:failed-assert id="CII-SR-182" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-182] - CalculatedAmount should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedTradeAllowanceCharge/ram:ChargeIndicator/udt:IndicatorString))">
    <svrl:failed-assert id="CII-SR-183" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-183] - IndicatorString should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedTradeAllowanceCharge/ram:ID))">
    <svrl:failed-assert id="CII-SR-184" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-184] - ID should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedTradeAllowanceCharge/ram:SequenceNumeric))">
    <svrl:failed-assert id="CII-SR-185" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-185] - SequenceNumeric should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedTradeAllowanceCharge/ram:CalculationPercent/@format))">
    <svrl:failed-assert id="CII-SR-186" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-186] - @format should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedTradeAllowanceCharge/ram:BasisQuantity))">
    <svrl:failed-assert id="CII-SR-187" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-187] - BasisQuantity should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedTradeAllowanceCharge/ram:PrepaidIndicator))">
    <svrl:failed-assert id="CII-SR-188" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-188] - PrepaidIndicator should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedTradeAllowanceCharge/ram:UnitBasisAmount))">
    <svrl:failed-assert id="CII-SR-189" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-189] - UnitBasisAmount should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedTradeAllowanceCharge/ram:TypeCode))">
    <svrl:failed-assert id="CII-SR-190" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-190] - TypeCode should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedTradeAllowanceCharge/ram:CategoryTradeTax))">
    <svrl:failed-assert id="CII-SR-191" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-191] - CategoryTradeTax should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedTradeAllowanceCharge/ram:ActualTradeCurrencyExchange))">
    <svrl:failed-assert id="CII-SR-192" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-192] - ActualTradeCurrencyExchange should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedTradeAllowanceCharge/ram:ID))">
    <svrl:failed-assert id="CII-SR-193" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-193] - ID should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SubtotalCalculatedTradeTax))">
    <svrl:failed-assert id="CII-SR-194" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-194] - SubtotalCalculatedTradeTax should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedLogisticsServiceCharge))">
    <svrl:failed-assert id="CII-SR-195" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-195] - SpecifiedLogisticsServiceCharge should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedTradePaymentTerms))">
    <svrl:failed-assert id="CII-SR-196" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-196] - SpecifiedTradePaymentTerms should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedTradeSettlementLineMonetarySummation/ram:ChargeTotalAmount))">
    <svrl:failed-assert id="CII-SR-197" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-197] - ChargeTotalAmount should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedTradeSettlementLineMonetarySummation/ram:AllowanceTotalAmount))">
    <svrl:failed-assert id="CII-SR-198" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-198] - AllowanceTotalAmount should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedTradeSettlementLineMonetarySummation/ram:TaxBasisTotalAmount))">
    <svrl:failed-assert id="CII-SR-199" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-199] - TaxBasisTotalAmount should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedTradeSettlementLineMonetarySummation/ram:TaxTotalAmount))">
    <svrl:failed-assert id="CII-SR-200" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-200] - TaxTotalAmount should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedTradeSettlementLineMonetarySummation/ram:GrandTotalAmount))">
    <svrl:failed-assert id="CII-SR-201" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-201] - GrandTotalAmount should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedTradeSettlementLineMonetarySummation/ram:InformationAmount))">
    <svrl:failed-assert id="CII-SR-202" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-202] - InformationAmount should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedTradeSettlementLineMonetarySummation/ram:TotalAllowanceChargeAmount))">
    <svrl:failed-assert id="CII-SR-203" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-203] - TotalAllowanceChargeAmount should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedTradeSettlementLineMonetarySummation/ram:TotalRetailValueInformationAmount))">
    <svrl:failed-assert id="CII-SR-204" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-204] - TotalRetailValueInformationAmount should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedTradeSettlementLineMonetarySummation/ram:GrossLineTotalAmount))">
    <svrl:failed-assert id="CII-SR-205" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-205] - GrossLineTotalAmount should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedTradeSettlementLineMonetarySummation/ram:NetLineTotalAmount))">
    <svrl:failed-assert id="CII-SR-206" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-206] - NetLineTotalAmount should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedTradeSettlementLineMonetarySummation/ram:NetIncludingTaxesLineTotalAmount))">
    <svrl:failed-assert id="CII-SR-207" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-207] - NetIncludingTaxesLineTotalAmount should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedTradeSettlementLineMonetarySummation/ram:ProductWeightLossInformationAmount))">
    <svrl:failed-assert id="CII-SR-208" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-208] - ProductWeightLossInformationAmount should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedFinancialAdjustment))">
    <svrl:failed-assert id="CII-SR-209" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-209] - SpecifiedFinancialAdjustment should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:InvoiceReferencedDocument))">
    <svrl:failed-assert id="CII-SR-210" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-210] - InvoiceReferencedDocument should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:PayableSpecifiedTradeAccountingAccount))">
    <svrl:failed-assert id="CII-SR-212" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-212] - PayableSpecifiedTradeAccountingAccount should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ReceivableSpecifiedTradeAccountingAccount/ram:SetTriggerCode))">
    <svrl:failed-assert id="CII-SR-213" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-213] - SetTriggerCode should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ReceivableSpecifiedTradeAccountingAccount/ram:TypeCode))">
    <svrl:failed-assert id="CII-SR-214" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-214] - TypeCode should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ReceivableSpecifiedTradeAccountingAccount/ram:AmountTypeCode))">
    <svrl:failed-assert id="CII-SR-215" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-215] - AmountTypeCode should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ReceivableSpecifiedTradeAccountingAccount/ram:Name))">
    <svrl:failed-assert id="CII-SR-216" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-216] - Name should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ReceivableSpecifiedTradeAccountingAccount/ram:CostReferenceDimensionPattern))">
    <svrl:failed-assert id="CII-SR-217" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-217] - CostReferenceDimensionPattern should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:PurchaseSpecifiedTradeAccountingAccount))">
    <svrl:failed-assert id="CII-SR-218" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-218] - PurchaseSpecifiedTradeAccountingAccount should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SalesSpecifiedTradeAccountingAccount))">
    <svrl:failed-assert id="CII-SR-219" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-219] - SalesSpecifiedTradeAccountingAccount should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedTradeSettlementFinancialCard))">
    <svrl:failed-assert id="CII-SR-220" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-220] - SpecifiedTradeSettlementFinancialCard should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(count(ram:ApplicableTradeTax) = 1)">
    <svrl:failed-assert id="CII-SR-454" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-454] - Only one ApplicableTradeTax should be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(count(ram:AdditionalReferencedDocument[normalize-space(ram:TypeCode) = '130']) <= 1)">
    <svrl:failed-assert id="CII-SR-474" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-474] - An invoice line shall not contain more than one AdditionalReferencedDocument with TypeCode 130.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: /rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement [EN16931-CII-Syntax] -->
<xsl:template match="/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement" mode="svrl" priority="172">
  <xsl:if test="not(not(ram:Reference))">
    <svrl:failed-assert id="CII-SR-442" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-442] - Reference should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SellerTradeParty/ram:RoleCode))">
    <svrl:failed-assert id="CII-SR-222" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-222] - RoleCode should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SellerTradeParty/ram:SpecifiedLegalOrganization/ram:LegalClassificationCode))">
    <svrl:failed-assert id="CII-SR-223" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-223] - LegalClassificationCode should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SellerTradeParty/ram:SpecifiedLegalOrganization/ram:Name))">
    <svrl:failed-assert id="CII-SR-224" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-224] - Name should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SellerTradeParty/ram:SpecifiedLegalOrganization/ram:PostalTradeAddress))">
    <svrl:failed-assert id="CII-SR-225" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-225] - PostalTradeAddress should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SellerTradeParty/ram:SpecifiedLegalOrganization/ram:AuthorizedLegalRegistration))">
    <svrl:failed-assert id="CII-SR-226" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-226] - RoleCode should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SellerTradeParty/ram:DefinedTradeContact/ram:ID))">
    <svrl:failed-assert id="CII-SR-227" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-227] - ID should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SellerTradeParty/ram:DefinedTradeContact/ram:TypeCode))">
    <svrl:failed-assert id="CII-SR-228" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-228] - TypeCode should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SellerTradeParty/ram:DefinedTradeContact/ram:JobTitle))">
    <svrl:failed-assert id="CII-SR-229" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-229] - JobTitle should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SellerTradeParty/ram:DefinedTradeContact/ram:Responsibility))">
    <svrl:failed-assert id="CII-SR-230" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-230] - Responsibility should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SellerTradeParty/ram:DefinedTradeContact/ram:PersonID))">
    <svrl:failed-assert id="CII-SR-231" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-231] - PersonID should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SellerTradeParty/ram:DefinedTradeContact/ram:TelephoneUniversalCommunication/ram:URIID))">
    <svrl:failed-assert id="CII-SR-232" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-232] - URIID should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SellerTradeParty/ram:DefinedTradeContact/ram:TelephoneUniversalCommunication/ram:ChannelCode))">
    <svrl:failed-assert id="CII-SR-233" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-233] - ChannelCode should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SellerTradeParty/ram:DefinedTradeContact/ram:DirectTelephoneUniversalCommunication))">
    <svrl:failed-assert id="CII-SR-234" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-234] - DirectTelephoneUniversalCommunication should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SellerTradeParty/ram:DefinedTradeContact/ram:MobileTelephoneUniversalCommunication))">
    <svrl:failed-assert id="CII-SR-235" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-235] - MobileTelephoneUniversalCommunication should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SellerTradeParty/ram:DefinedTradeContact/ram:FaxUniversalCommunication))">
    <svrl:failed-assert id="CII-SR-236" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-236] - FaxUniversalCommunication should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SellerTradeParty/ram:DefinedTradeContact/ram:EmailURIUniversalCommunication/ram:ChannelCode))">
    <svrl:failed-assert id="CII-SR-237" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-237] - ChannelCode should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SellerTradeParty/ram:DefinedTradeContact/ram:EmailURIUniversalCommunication/ram:CompleteNumber))">
    <svrl:failed-assert id="CII-SR-238" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-238] - CompleteNumber should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SellerTradeParty/ram:DefinedTradeContact/ram:TelexUniversalCommunication))">
    <svrl:failed-assert id="CII-SR-239" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-239] - TelexUniversalCommunication should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SellerTradeParty/ram:DefinedTradeContact/ram:VOIPUniversalCommunication))">
    <svrl:failed-assert id="CII-SR-240" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-240] - VOIPUniversalCommunication should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SellerTradeParty/ram:DefinedTradeContact/ram:InstantMessagingUniversalCommunication))">
    <svrl:failed-assert id="CII-SR-241" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-241] - InstantMessagingUniversalCommunication should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SellerTradeParty/ram:DefinedTradeContact/ram:SpecifiedNote))">
    <svrl:failed-assert id="CII-SR-242" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-242] - SpecifiedNote should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SellerTradeParty/ram:DefinedTradeContact/ram:SpecifiedContactPerson))">
    <svrl:failed-assert id="CII-SR-243" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-243] - SpecifiedContactPerson should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SellerTradeParty/ram:URIUniversalCommunication/ram:ChannelCode))">
    <svrl:failed-assert id="CII-SR-244" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-244] - ChannelCode should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SellerTradeParty/ram:URIUniversalCommunication/ram:CompleteNumber))">
    <svrl:failed-assert id="CII-SR-245" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-245] - CompleteNumber should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SellerTradeParty/ram:SpecifiedTaxRegistration/ram:AssociatedRegisteredTax))">
    <svrl:failed-assert id="CII-SR-246" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-246] - AssociatedRegisteredTax should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SellerTradeParty/ram:EndPointURIUniversalCommunication))">
    <svrl:failed-assert id="CII-SR-247" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-247] - EndPointURIUniversalCommunication should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SellerTradeParty/ram:LogoAssociatedSpecifiedBinaryFile))">
    <svrl:failed-assert id="CII-SR-248" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-248] - LogoAssociatedSpecifiedBinaryFile should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:BuyerTradeParty/ram:RoleCode))">
    <svrl:failed-assert id="CII-SR-249" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-249] - RoleCode should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:BuyerTradeParty/ram:Description))">
    <svrl:failed-assert id="CII-SR-250" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-250] - Description should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:BuyerTradeParty/ram:SpecifiedLegalOrganization/ram:LegalClassificationCode))">
    <svrl:failed-assert id="CII-SR-251" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-251] - LegalClassificationCode should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:BuyerTradeParty/ram:SpecifiedLegalOrganization/ram:Name))">
    <svrl:failed-assert id="CII-SR-252" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-252] - Name should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:BuyerTradeParty/ram:SpecifiedLegalOrganization/ram:PostalTradeAddress))">
    <svrl:failed-assert id="CII-SR-254" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-254] - PostalTradeAddress should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:BuyerTradeParty/ram:SpecifiedLegalOrganization/ram:AuthorizedLegalRegistration))">
    <svrl:failed-assert id="CII-SR-255" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-255] - AuthorizedLegalRegistration should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:BuyerTradeParty/ram:DefinedTradeContact/ram:ID))">
    <svrl:failed-assert id="CII-SR-256" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-256] - ID should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:BuyerTradeParty/ram:DefinedTradeContact/ram:TypeCode))">
    <svrl:failed-assert id="CII-SR-257" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-257] - TypeCode should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:BuyerTradeParty/ram:DefinedTradeContact/ram:JobTitle))">
    <svrl:failed-assert id="CII-SR-258" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-258] - JobTitle should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:BuyerTradeParty/ram:DefinedTradeContact/ram:Responsibility))">
    <svrl:failed-assert id="CII-SR-259" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-259] - Responsibility should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:BuyerTradeParty/ram:DefinedTradeContact/ram:PersonID))">
    <svrl:failed-assert id="CII-SR-260" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-260] - PersonID should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:BuyerTradeParty/ram:DefinedTradeContact/ram:TelephoneUniversalCommunication/ram:URIID))">
    <svrl:failed-assert id="CII-SR-261" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-261] - URIID should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:BuyerTradeParty/ram:DefinedTradeContact/ram:TelephoneUniversalCommunication/ram:ChannelCode))">
    <svrl:failed-assert id="CII-SR-262" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-262] - ChannelCode should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:BuyerTradeParty/ram:DefinedTradeContact/ram:DirectTelephoneUniversalCommunication))">
    <svrl:failed-assert id="CII-SR-263" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-263] - DirectTelephoneUniversalCommunication should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:BuyerTradeParty/ram:DefinedTradeContact/ram:MobileTelephoneUniversalCommunication))">
    <svrl:failed-assert id="CII-SR-264" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-264] - MobileTelephoneUniversalCommunication should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:BuyerTradeParty/ram:DefinedTradeContact/ram:FaxUniversalCommunication))">
    <svrl:failed-assert id="CII-SR-265" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-265] - FaxUniversalCommunication should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:BuyerTradeParty/ram:DefinedTradeContact/ram:EmailURIUniversalCommunication/ram:ChannelCode))">
    <svrl:failed-assert id="CII-SR-266" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-266] - ChannelCode should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:BuyerTradeParty/ram:DefinedTradeContact/ram:EmailURIUniversalCommunication/ram:CompleteNumber))">
    <svrl:failed-assert id="CII-SR-267" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-267] - CompleteNumber should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:BuyerTradeParty/ram:DefinedTradeContact/ram:TelexUniversalCommunication))">
    <svrl:failed-assert id="CII-SR-268" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-268] - TelexUniversalCommunication should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:BuyerTradeParty/ram:DefinedTradeContact/ram:VOIPUniversalCommunication))">
    <svrl:failed-assert id="CII-SR-269" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-269] - VOIPUniversalCommunication should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:BuyerTradeParty/ram:DefinedTradeContact/ram:InstantMessagingUniversalCommunication))">
    <svrl:failed-assert id="CII-SR-270" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-270] - InstantMessagingUniversalCommunication should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:BuyerTradeParty/ram:DefinedTradeContact/ram:SpecifiedNote))">
    <svrl:failed-assert id="CII-SR-271" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-271] - SpecifiedNote should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:BuyerTradeParty/ram:DefinedTradeContact/ram:SpecifiedContactPerson))">
    <svrl:failed-assert id="CII-SR-272" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-272] - SpecifiedContactPerson should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:BuyerTradeParty/ram:URIUniversalCommunication/ram:ChannelCode))">
    <svrl:failed-assert id="CII-SR-273" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-273] - ChannelCode should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:BuyerTradeParty/ram:URIUniversalCommunication/ram:CompleteNumber))">
    <svrl:failed-assert id="CII-SR-274" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-274] - CompleteNumber should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:BuyerTradeParty/ram:SpecifiedTaxRegistration/ram:AssociatedRegisteredTax))">
    <svrl:failed-assert id="CII-SR-275" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-275] - AssociatedRegisteredTax should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:BuyerTradeParty/ram:EndPointURIUniversalCommunication))">
    <svrl:failed-assert id="CII-SR-276" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-276] - EndPointURIUniversalCommunication should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:BuyerTradeParty/ram:LogoAssociatedSpecifiedBinaryFile))">
    <svrl:failed-assert id="CII-SR-277" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-277] - LogoAssociatedSpecifiedBinaryFile should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SalesAgentTradeParty))">
    <svrl:failed-assert id="CII-SR-278" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-278] - SalesAgentTradeParty should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:BuyerRequisitionerTradeParty))">
    <svrl:failed-assert id="CII-SR-279" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-279] - BuyerRequisitionerTradeParty should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:BuyerAssignedAccountantTradeParty))">
    <svrl:failed-assert id="CII-SR-280" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-280] - BuyerAssignedAccountantTradeParty should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SellerAssignedAccountantTradeParty))">
    <svrl:failed-assert id="CII-SR-281" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-281] - SellerAssignedAccountantTradeParty should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SellerTaxRepresentativeTradeParty/ram:ID))">
    <svrl:failed-assert id="CII-SR-282" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-282] - BuyerTaxRepresentativeTradeParty should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SellerTaxRepresentativeTradeParty/ram:GlobalID))">
    <svrl:failed-assert id="CII-SR-283" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-283] - GlobalID should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SellerTaxRepresentativeTradeParty/ram:RoleCode))">
    <svrl:failed-assert id="CII-SR-284" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-284] - RoleCode should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SellerTaxRepresentativeTradeParty/ram:Description))">
    <svrl:failed-assert id="CII-SR-285" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-285] - Description should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SellerTaxRepresentativeTradeParty/ram:SpecifiedLegalOrganization))">
    <svrl:failed-assert id="CII-SR-286" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-286] - SpecifiedLegalOrganization should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SellerTaxRepresentativeTradeParty/ram:DefinedTradeContact))">
    <svrl:failed-assert id="CII-SR-287" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-287] - DefinedTradeContact should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SellerTaxRepresentativeTradeParty/ram:URIUniversalCommunication))">
    <svrl:failed-assert id="CII-SR-288" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-288] - URIUniversalCommunication should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SellerTaxRepresentativeTradeParty/ram:SpecifiedTaxRegistration/ram:AssociatedRegisteredTax))">
    <svrl:failed-assert id="CII-SR-289" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-289] - AssociatedRegisteredTax should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SellerTaxRepresentativeTradeParty/ram:EndPointURIUniversalCommunication))">
    <svrl:failed-assert id="CII-SR-290" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-290] - EndPointURIUniversalCommunication should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SellerTaxRepresentativeTradeParty/ram:LogoAssociatedSpecifiedBinaryFile))">
    <svrl:failed-assert id="CII-SR-291" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-291] - LogoAssociatedSpecifiedBinaryFile should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ProductEndUserTradeParty))">
    <svrl:failed-assert id="CII-SR-292" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-292] - ProductEndUserTradeParty should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ApplicableTradeDeliveryTerms))">
    <svrl:failed-assert id="CII-SR-293" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-293] - ApplicableTradeDeliveryTerms should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SellerOrderReferencedDocument/ram:LineID))">
    <svrl:failed-assert id="CII-SR-294" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-294] - LineID should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:BuyerOrderReferencedDocument/ram:LineID))">
    <svrl:failed-assert id="CII-SR-295" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-295] - LineID should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:QuotationReferencedDocument))">
    <svrl:failed-assert id="CII-SR-296" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-296] - QuotationReferencedDocument should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:OrderResponseReferencedDocument))">
    <svrl:failed-assert id="CII-SR-297" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-297] - OrderResponseReferencedDocument should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ContractReferencedDocument/ram:LineID))">
    <svrl:failed-assert id="CII-SR-298" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-298] - LineID should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:DemandForecastReferencedDocument))">
    <svrl:failed-assert id="CII-SR-299" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-299] - DemandForecastReferencedDocument should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SupplyInstructionReferencedDocument))">
    <svrl:failed-assert id="CII-SR-300" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-300] - SupplyInstructionReferencedDocument should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:PromotionalDealReferencedDocument))">
    <svrl:failed-assert id="CII-SR-301" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-301] - PromotionalDealReferencedDocument should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:PriceListReferencedDocument))">
    <svrl:failed-assert id="CII-SR-302" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-302] - PriceListReferencedDocument should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:AdditionalReferencedDocument/ram:LineID))">
    <svrl:failed-assert id="CII-SR-303" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-303] - LineID should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:RequisitionerReferencedDocument))">
    <svrl:failed-assert id="CII-SR-304" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-304] - RequisitionerReferencedDocument should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:BuyerAgentTradeParty))">
    <svrl:failed-assert id="CII-SR-305" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-305] - BuyerAgentTradeParty should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:PurchaseConditionsReferencedDocument))">
    <svrl:failed-assert id="CII-SR-306" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-306] - PurchaseConditionsReferencedDocument should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedProcuringProject/ram:Description))">
    <svrl:failed-assert id="CII-SR-307" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-307] - Description should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:UltimateCustomerOrderReferencedDocument))">
    <svrl:failed-assert id="CII-SR-448" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-448] - UltimateCustomerOrderReferencedDocument should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not((not(ram:BuyerTradeParty/ram:ID) and ram:BuyerTradeParty/ram:GlobalID) or (ram:BuyerTradeParty/ram:ID and not(ram:BuyerTradeParty/ram:GlobalID)) or (not(ram:BuyerTradeParty/ram:ID) and not(ram:BuyerTradeParty/ram:GlobalID)))">
    <svrl:failed-assert id="CII-SR-450" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-450] - Only one  buyer identifier should be present (either the ID or the Global ID)</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(( count(ram:SellerTradeParty/ram:DefinedTradeContact)  <= 1))">
    <svrl:failed-assert id="CII-SR-455" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-SR-455] - DefinedTradeContact of SellerTradeParty shall exist maximum once</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(( count(ram:BuyerTradeParty/ram:DefinedTradeContact)  <= 1))">
    <svrl:failed-assert id="CII-SR-456" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-SR-456] - DefinedTradeContact of BuyerTradeParty shall exist maximum once</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(( count(ram:AdditionalReferencedDocument[ram:TypeCode='50'])  <= 1))">
    <svrl:failed-assert id="CII-SR-457" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-457] - IssuerAssignedID with TypeCode 50 should exist maximum once</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(( count(ram:AdditionalReferencedDocument[ram:TypeCode='130'])  <= 1))">
    <svrl:failed-assert id="CII-SR-458" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-458] - IssuerAssignedID with TypeCode 130 should exist maximum once</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(count(ram:SellerTradeParty/ram:URIUniversalCommunication) <= 1)">
    <svrl:failed-assert id="CII-SR-459" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-SR-459] - SellerTradeParty URIUniversalCommunication should exist maximum once</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(count(ram:BuyerTradeParty/ram:URIUniversalCommunication) <= 1)">
    <svrl:failed-assert id="CII-SR-460" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-SR-460] - BuyerTradeParty URIUniversalCommunication should exist maximum once</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SellerTradeParty/ram:DefinedTradeContact/ram:PersonName and ram:SellerTradeParty/ram:DefinedTradeContact/ram:DepartmentName))">
    <svrl:failed-assert id="CII-SR-465" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-465] - Only one BT-41 element is allowed on an invoice.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:BuyerTradeParty/ram:DefinedTradeContact/ram:PersonName and ram:BuyerTradeParty/ram:DefinedTradeContact/ram:DepartmentName))">
    <svrl:failed-assert id="CII-SR-466" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-466] - Only one BT-56 element is allowed on an invoice.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(count(ram:AdditionalReferencedDocument[normalize-space(ram:TypeCode) = '916']/ram:Name) <= 1)">
    <svrl:failed-assert id="CII-SR-475" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-475] - Only one AdditionalReferencedDocument Name BT-123 is allowed with TypeCode 916.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(count(ram:AdditionalReferencedDocument[normalize-space(ram:TypeCode) = '916']/ram:AttachmentBinaryObject) <= 1)">
    <svrl:failed-assert id="CII-SR-476" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-476] - Only one AdditionalReferencedDocument AttachmentBinaryObject BT-125 is allowed with TypeCode 916.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: /rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement [EN16931-CII-Syntax] -->
<xsl:template match="/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement" mode="svrl" priority="173">
  <xsl:if test="not(not(ram:DuePayableAmount))">
    <svrl:failed-assert id="CII-SR-339" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-339] - DuePayableAmount should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:CreditorReferenceTypeCode))">
    <svrl:failed-assert id="CII-SR-340" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-340] - CreditorReferenceTypeCode should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:CreditorReferenceType))">
    <svrl:failed-assert id="CII-SR-341" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-341] - CreditorReferenceType should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:CreditorReferenceIssuerID))">
    <svrl:failed-assert id="CII-SR-342" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-342] - CreditorReferenceIssuerID should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:PaymentCurrencyCode))">
    <svrl:failed-assert id="CII-SR-344" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-344] - PaymentCurrencyCode should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:InvoiceIssuerReference))">
    <svrl:failed-assert id="CII-SR-345" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-345] - InvoiceIssuerReference should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:InvoiceDateTime))">
    <svrl:failed-assert id="CII-SR-346" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-346] - InvoiceDateTime should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:NextInvoiceDateTime))">
    <svrl:failed-assert id="CII-SR-347" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-347] - NextInvoiceDateTime should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:CreditReasonCode))">
    <svrl:failed-assert id="CII-SR-348" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-348] - CreditReasonCode should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:CreditReason))">
    <svrl:failed-assert id="CII-SR-349" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-349] - CreditReason should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:InvoicerTradeParty))">
    <svrl:failed-assert id="CII-SR-350" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-350] - InvoicerTradeParty should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:InvoiceeTradeParty))">
    <svrl:failed-assert id="CII-SR-351" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-351] - InvoiceeTradeParty should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:PayeeTradeParty/ram:RoleCode))">
    <svrl:failed-assert id="CII-SR-352" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-352] - RoleCode should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:PayeeTradeParty/ram:Description))">
    <svrl:failed-assert id="CII-SR-353" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-353] - Description should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:PayeeTradeParty/ram:SpecifiedLegalOrganization/ram:LegalClassificationCode))">
    <svrl:failed-assert id="CII-SR-354" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-354] - LegalClassificationCode should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:PayeeTradeParty/ram:SpecifiedLegalOrganization/ram:Name))">
    <svrl:failed-assert id="CII-SR-355" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-355] - Name should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:PayeeTradeParty/ram:SpecifiedLegalOrganization/ram:TradingBusinessName))">
    <svrl:failed-assert id="CII-SR-356" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-356] - TradingBusinessName should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:PayeeTradeParty/ram:SpecifiedLegalOrganization/ram:PostalTradeAddress))">
    <svrl:failed-assert id="CII-SR-357" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-357] - PostalTradeAddress should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:PayeeTradeParty/ram:SpecifiedLegalOrganization/ram:AuthorizedLegalRegistration))">
    <svrl:failed-assert id="CII-SR-358" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-358] - AuthorizedLegalRegistration should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:PayeeTradeParty/ram:DefinedTradeContact))">
    <svrl:failed-assert id="CII-SR-359" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-359] - DefinedTradeContact should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:PayeeTradeParty/ram:PostalTradeAddress))">
    <svrl:failed-assert id="CII-SR-360" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-360] - PostalTradeAddress should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:PayeeTradeParty/ram:URIUniversalCommunication))">
    <svrl:failed-assert id="CII-SR-361" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-361] - URIUniversalCommunication should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:PayeeTradeParty/ram:SpecifiedTaxRegistration))">
    <svrl:failed-assert id="CII-SR-362" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-362] - SpecifiedTaxRegistration should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:PayeeTradeParty/ram:EndPointURIUniversalCommunication))">
    <svrl:failed-assert id="CII-SR-363" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-363] - EndPointURIUniversalCommunication should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:PayeeTradeParty/ram:LogoAssociatedSpecifiedBinaryFile))">
    <svrl:failed-assert id="CII-SR-364" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-364] - LogoAssociatedSpecifiedBinaryFile should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not((not(ram:PayeeTradeParty/ram:ID) and ram:PayeeTradeParty/ram:GlobalID) or (ram:PayeeTradeParty/ram:ID and not(ram:PayeeTradeParty/ram:GlobalID)) or (not(ram:PayeeTradeParty/ram:ID) and not(ram:PayeeTradeParty/ram:GlobalID)))">
    <svrl:failed-assert id="CII-SR-451" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-451] - Only one payee identifier should be present (either the ID or the Global ID)</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:PayerTradeParty))">
    <svrl:failed-assert id="CII-SR-365" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-365] - PayerTradeParty should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:TaxApplicableTradeCurrencyExchange))">
    <svrl:failed-assert id="CII-SR-366" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-366] - TaxApplicableTradeCurrencyExchange should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:InvoiceApplicableTradeCurrencyExchange))">
    <svrl:failed-assert id="CII-SR-367" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-367] - InvoiceApplicableTradeCurrencyExchange should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:PaymentApplicableTradeCurrencyExchange))">
    <svrl:failed-assert id="CII-SR-368" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-368] - PaymentApplicableTradeCurrencyExchange should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedTradeSettlementPaymentMeans/ram:PaymentChannelCode))">
    <svrl:failed-assert id="CII-SR-369" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-369] - PaymentChannelCode should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedTradeSettlementPaymentMeans/ram:GuaranteeMethodCode))">
    <svrl:failed-assert id="CII-SR-370" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-370] - GuaranteeMethodCode should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedTradeSettlementPaymentMeans/ram:PaymentMethodCode))">
    <svrl:failed-assert id="CII-SR-371" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-371] - PaymentMethodCode should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedTradeSettlementPaymentMeans/ram:ID))">
    <svrl:failed-assert id="CII-SR-443" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-443] - ID should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedTradeSettlementPaymentMeans/ram:ApplicableTradeSettlementFinancialCard/ram:MicrochipIndicator))">
    <svrl:failed-assert id="CII-SR-372" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-372] - MicrochipIndicator should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedTradeSettlementPaymentMeans/ram:ApplicableTradeSettlementFinancialCard/ram:TypeCode))">
    <svrl:failed-assert id="CII-SR-373" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-373] - TypeCode should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedTradeSettlementPaymentMeans/ram:ApplicableTradeSettlementFinancialCard/ram:ExpiryDate))">
    <svrl:failed-assert id="CII-SR-375" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-375] - ExpiryDate should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedTradeSettlementPaymentMeans/ram:ApplicableTradeSettlementFinancialCard/ram:VerificationNumeric))">
    <svrl:failed-assert id="CII-SR-376" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-376] - VerificationNumeric should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedTradeSettlementPaymentMeans/ram:ApplicableTradeSettlementFinancialCard/ram:ValidFromDateTime))">
    <svrl:failed-assert id="CII-SR-377" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-377] - ValidFromDateTime should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedTradeSettlementPaymentMeans/ram:ApplicableTradeSettlementFinancialCard/ram:CreditLimitAmount))">
    <svrl:failed-assert id="CII-SR-378" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-378] - CreditLimitAmountshould not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedTradeSettlementPaymentMeans/ram:ApplicableTradeSettlementFinancialCard/ram:CreditAvailableAmount))">
    <svrl:failed-assert id="CII-SR-379" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-379] - CreditAvailableAmount should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedTradeSettlementPaymentMeans/ram:ApplicableTradeSettlementFinancialCard/ram:InterestRatePercent))">
    <svrl:failed-assert id="CII-SR-380" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-380] - InterestRatePercent should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedTradeSettlementPaymentMeans/ram:ApplicableTradeSettlementFinancialCard/ram:Description))">
    <svrl:failed-assert id="CII-SR-381" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-381] - Description should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedTradeSettlementPaymentMeans/ram:PayerPartyDebtorFinancialAccount/ram:AccountName))">
    <svrl:failed-assert id="CII-SR-382" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-382] - AccountName should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedTradeSettlementPaymentMeans/ram:PayerPartyDebtorFinancialAccount/ram:ProprietaryID))">
    <svrl:failed-assert id="CII-SR-444" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-444] - ProprietaryID should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedTradeSettlementPaymentMeans/ram:PayerSpecifiedDebtorFinancialInstitution/ram:ClearingSystemName))">
    <svrl:failed-assert id="CII-SR-384" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-384] - ClearingSystemName should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedTradeSettlementPaymentMeans/ram:PayerSpecifiedDebtorFinancialInstitution/ram:Name))">
    <svrl:failed-assert id="CII-SR-385" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-385] - Name should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedTradeSettlementPaymentMeans/ram:PayerSpecifiedDebtorFinancialInstitution/ram:LocationFinancialInstitutionAddress))">
    <svrl:failed-assert id="CII-SR-386" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-386] - LocationFinancialInstitutionAddress should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedTradeAllowanceCharge/ram:ID))">
    <svrl:failed-assert id="CII-SR-388" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-388] - ID should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedTradeAllowanceCharge/ram:SequenceNumeric))">
    <svrl:failed-assert id="CII-SR-389" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-389] - SequenceNumeric should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedTradeAllowanceCharge/ram:BasisQuantity))">
    <svrl:failed-assert id="CII-SR-390" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-390] - BasisQuantity should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedTradeAllowanceCharge/ram:PrepaidIndicator))">
    <svrl:failed-assert id="CII-SR-391" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-391] - PrepaidIndicator should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedTradeAllowanceCharge/ram:UnitBasisAmount))">
    <svrl:failed-assert id="CII-SR-392" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-392] - UnitBasisAmount should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedTradeAllowanceCharge/ram:TypeCode))">
    <svrl:failed-assert id="CII-SR-393" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-393] - TypeCode should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedTradeAllowanceCharge/ram:ActualTradeCurrencyExchange))">
    <svrl:failed-assert id="CII-SR-394" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-394] - ActualTradeCurrencyExchange should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SubtotalCalculatedTradeTax))">
    <svrl:failed-assert id="CII-SR-395" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-395] - SubtotalCalculatedTradeTax should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedLogisticsServiceCharge))">
    <svrl:failed-assert id="CII-SR-396" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-396] - SpecifiedLogisticsServiceCharge should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedTradePaymentTerms/ram:ID))">
    <svrl:failed-assert id="CII-SR-397" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-397] - ID should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedTradePaymentTerms/ram:FromEventCode))">
    <svrl:failed-assert id="CII-SR-398" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-398] - FromEventCode should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedTradePaymentTerms/ram:SettlementPeriodMeasure))">
    <svrl:failed-assert id="CII-SR-399" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-399] - SettlementPeriodMeasure should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedTradePaymentTerms/ram:DueDateDateTime/udt:DateTime))">
    <svrl:failed-assert id="CII-SR-400" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-400] - DateTime should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedTradePaymentTerms/ram:TypeCode))">
    <svrl:failed-assert id="CII-SR-401" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-401] - TypeCode should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedTradePaymentTerms/ram:InstructionTypeCode))">
    <svrl:failed-assert id="CII-SR-402" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-402] - InstructionTypeCode should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedTradePaymentTerms/ram:PartialPaymentPercent))">
    <svrl:failed-assert id="CII-SR-404" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-404] - PartialPaymentPercent should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedTradePaymentTerms/ram:PaymentMeansID))">
    <svrl:failed-assert id="CII-SR-405" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-405] - PaymentMeansID should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedTradePaymentTerms/ram:PartialPaymentAmount))">
    <svrl:failed-assert id="CII-SR-406" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-406] - PartialPaymentAmount should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedTradePaymentTerms/ram:ApplicableTradePaymentPenaltyTerms))">
    <svrl:failed-assert id="CII-SR-407" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-407] - ApplicableTradePaymentPenaltyTerms should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedTradePaymentTerms/ram:ApplicableTradePaymentDiscountTerms))">
    <svrl:failed-assert id="CII-SR-408" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-408] - ApplicableTradePaymentDiscountTerms should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedTradePaymentTerms/ram:PayeeTradeParty))">
    <svrl:failed-assert id="CII-SR-409" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-409] - PayeeTradeParty should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedFinancialAdjustment))">
    <svrl:failed-assert id="CII-SR-421" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-421] - SpecifiedFinancialAdjustment should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:InvoiceReferencedDocument/ram:LineID))">
    <svrl:failed-assert id="CII-SR-422" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-422] - LineID should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ProFormaInvoiceReferencedDocument))">
    <svrl:failed-assert id="CII-SR-423" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-423] - ProFormaInvoiceReferencedDocument should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:LetterOfCreditReferencedDocument))">
    <svrl:failed-assert id="CII-SR-424" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-424] - LetterOfCreditReferencedDocument should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:FactoringAgreementReferencedDocument))">
    <svrl:failed-assert id="CII-SR-425" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-425] - FactoringAgreementReferencedDocument should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:FactoringListReferencedDocument))">
    <svrl:failed-assert id="CII-SR-426" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-426] - FactoringListReferencedDocument should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:PayableSpecifiedTradeAccountingAccount))">
    <svrl:failed-assert id="CII-SR-427" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-427] - PayableSpecifiedTradeAccountingAccount should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ReceivableSpecifiedTradeAccountingAccount/ram:SetTriggerCode))">
    <svrl:failed-assert id="CII-SR-428" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-428] - SetTriggerCode should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ReceivableSpecifiedTradeAccountingAccount/ram:TypeCode))">
    <svrl:failed-assert id="CII-SR-429" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-429] - TypeCode should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ReceivableSpecifiedTradeAccountingAccount/ram:AmountTypeCode))">
    <svrl:failed-assert id="CII-SR-430" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-430] - AmountTypeCode should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ReceivableSpecifiedTradeAccountingAccount/ram:Name))">
    <svrl:failed-assert id="CII-SR-431" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-431] - Name should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ReceivableSpecifiedTradeAccountingAccount/ram:CostReferenceDimensionPattern))">
    <svrl:failed-assert id="CII-SR-432" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-432] - CostReferenceDimensionPattern should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:PurchaseSpecifiedTradeAccountingAccount))">
    <svrl:failed-assert id="CII-SR-433" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-433] - PurchaseSpecifiedTradeAccountingAccount should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SalesSpecifiedTradeAccountingAccount))">
    <svrl:failed-assert id="CII-SR-434" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-434] - SalesSpecifiedTradeAccountingAccount should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedTradeSettlementFinancialCard))">
    <svrl:failed-assert id="CII-SR-435" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-435] - SpecifiedTradeSettlementFinancialCard should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedAdvancePayment))">
    <svrl:failed-assert id="CII-SR-436" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-436] - SpecifiedAdvancePayment should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:UltimatePayeeTradeParty))">
    <svrl:failed-assert id="CII-SR-437" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-437] - UltimatePayeeTradeParty should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(count(ram:SpecifiedTradePaymentTerms) <= 1)">
    <svrl:failed-assert id="CII-SR-452" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-452] - Only one SpecifiedTradePaymentTerms should be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(count(ram:SpecifiedTradePaymentTerms/ram:Description) <= 1)">
    <svrl:failed-assert id="CII-SR-453" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-453] - Only one SpecifiedTradePaymentTerms Description should be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(count(ram:ApplicableTradeTax/ram:TaxPointDate) <= 1)">
    <svrl:failed-assert id="CII-SR-461" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-SR-461] - Only one TaxPointDate shall be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(count(//ram:ApplicableTradeTax/ram:DueDateTypeCode) = 0 or count(distinct-values(//ram:ApplicableTradeTax/ram:DueDateTypeCode)) = 1)">
    <svrl:failed-assert id="CII-SR-462" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-SR-462] - Only one DueDateTypeCode shall be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(count(ram:SpecifiedTradeSettlementPaymentMeans[(normalize-space(ram:TypeCode) = '30' or normalize-space(ram:TypeCode) = '58') and not(ram:PayeePartyCreditorFinancialAccount/ram:IBANID or ram:PayeePartyCreditorFinancialAccount/ram:ProprietaryID)]) = 0)">
    <svrl:failed-assert id="CII-SR-470" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-SR-470] - Either the IBAN or a Proprietary ID (BT-84) shall be used.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: /rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeSettlementHeaderMonetarySummation [EN16931-CII-Syntax] -->
<xsl:template match="/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeSettlementHeaderMonetarySummation" mode="svrl" priority="174">
  <xsl:if test="not(not(ram:InformationAmount))">
    <svrl:failed-assert id="CII-SR-411" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-411] - InformationAmount should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:TotalDiscountAmount))">
    <svrl:failed-assert id="CII-SR-412" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-412] - TotalDiscountAmount should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:TotalAllowanceChargeAmount))">
    <svrl:failed-assert id="CII-SR-413" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-413] - TotalAllowanceChargeAmount should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:RetailValueExcludingTaxInformationAmount))">
    <svrl:failed-assert id="CII-SR-414" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-414] - RetailValueExcludingTaxInformationAmount should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:TotalDepositFeeInformationAmount))">
    <svrl:failed-assert id="CII-SR-415" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-415] - TotalDepositFeeInformationAmount should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ProductValueExcludingTobaccoTaxInformationAmount))">
    <svrl:failed-assert id="CII-SR-416" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-416] - ProductValueExcludingTobaccoTaxInformationAmount should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:TotalRetailValueInformationAmount))">
    <svrl:failed-assert id="CII-SR-417" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-417] - TotalRetailValueInformationAmount should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:GrossLineTotalAmount))">
    <svrl:failed-assert id="CII-SR-418" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-418] - GrossLineTotalAmount should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:NetLineTotalAmount))">
    <svrl:failed-assert id="CII-SR-419" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-419] - NetLineTotalAmount should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:NetIncludingTaxesLineTotalAmount))">
    <svrl:failed-assert id="CII-SR-420" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-420] - NetIncludingTaxesLineTotalAmount should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(count(ram:LineTotalAmount) <= 1)">
    <svrl:failed-assert id="CII-SR-477" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-SR-477] - LineTotalAmount shall occur at most once in SpecifiedTradeSettlementHeaderMonetarySummation.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(count(ram:ChargeTotalAmount) <= 1)">
    <svrl:failed-assert id="CII-SR-478" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-SR-478] - ChargeTotalAmount shall occur at most once in SpecifiedTradeSettlementHeaderMonetarySummation.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(count(ram:AllowanceTotalAmount) <= 1)">
    <svrl:failed-assert id="CII-SR-479" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-SR-479] - AllowanceTotalAmount shall occur at most once in SpecifiedTradeSettlementHeaderMonetarySummation.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(count(ram:TaxBasisTotalAmount) <= 1)">
    <svrl:failed-assert id="CII-SR-480" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-SR-480] - TaxBasisTotalAmount shall occur at most once in SpecifiedTradeSettlementHeaderMonetarySummation.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(count(ram:RoundingAmount) <= 1)">
    <svrl:failed-assert id="CII-SR-481" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-SR-481] - RoundingAmount shall occur at most once in SpecifiedTradeSettlementHeaderMonetarySummation.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(count(ram:GrandTotalAmount) <= 1)">
    <svrl:failed-assert id="CII-SR-482" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-SR-482] - GrandTotalAmount shall occur at most once in SpecifiedTradeSettlementHeaderMonetarySummation.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(count(ram:InformationAmount) <= 1)">
    <svrl:failed-assert id="CII-SR-483" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-SR-483] - InformationAmount shall occur at most once in SpecifiedTradeSettlementHeaderMonetarySummation.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(count(ram:TotalPrepaidAmount) <= 1)">
    <svrl:failed-assert id="CII-SR-484" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-SR-484] - TotalPrepaidAmount shall occur at most once in SpecifiedTradeSettlementHeaderMonetarySummation.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(count(ram:TotalDiscountAmount) <= 1)">
    <svrl:failed-assert id="CII-SR-485" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-SR-485] - TotalDiscountAmount shall occur at most once in SpecifiedTradeSettlementHeaderMonetarySummation.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(count(ram:TotalAllowanceChargeAmount) <= 1)">
    <svrl:failed-assert id="CII-SR-486" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-SR-486] - TotalAllowanceChargeAmount shall occur at most once in SpecifiedTradeSettlementHeaderMonetarySummation.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(count(ram:DuePayableAmount) <= 1)">
    <svrl:failed-assert id="CII-SR-487" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-SR-487] - DuePayableAmount shall occur at most once in SpecifiedTradeSettlementHeaderMonetarySummation.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(count(ram:RetailValueExcludingTaxInformationAmount) <= 1)">
    <svrl:failed-assert id="CII-SR-488" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-SR-488] - RetailValueExcludingTaxInformationAmount shall occur at most once in SpecifiedTradeSettlementHeaderMonetarySummation.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(count(ram:TotalDepositFeeInformationAmount) <= 1)">
    <svrl:failed-assert id="CII-SR-489" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-SR-489] - TotalDepositFeeInformationAmount shall occur at most once in SpecifiedTradeSettlementHeaderMonetarySummation.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(count(ram:ProductValueExcludingTobaccoTaxInformationAmount) <= 1)">
    <svrl:failed-assert id="CII-SR-490" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-SR-490] - ProductValueExcludingTobaccoTaxInformationAmount shall occur at most once in SpecifiedTradeSettlementHeaderMonetarySummation.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(count(ram:TotalRetailValueInformationAmount) <= 1)">
    <svrl:failed-assert id="CII-SR-491" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-SR-491] - TotalRetailValueInformationAmount shall occur at most once in SpecifiedTradeSettlementHeaderMonetarySummation.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(count(ram:GrossLineTotalAmount) <= 1)">
    <svrl:failed-assert id="CII-SR-492" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-SR-492] - GrossLineTotalAmount shall occur at most once in SpecifiedTradeSettlementHeaderMonetarySummation.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(count(ram:NetLineTotalAmount) <= 1)">
    <svrl:failed-assert id="CII-SR-493" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-SR-493] - NetLineTotalAmount shall occur at most once in SpecifiedTradeSettlementHeaderMonetarySummation.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(count(ram:NetIncludingTaxesLineTotalAmount) <= 1)">
    <svrl:failed-assert id="CII-SR-494" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-SR-494] - NetIncludingTaxesLineTotalAmount shall occur at most once in SpecifiedTradeSettlementHeaderMonetarySummation.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: *[ends-with(name(), 'DocumentContextParameter')] [EN16931-CII-Syntax] -->
<xsl:template match="*[ends-with(name(), 'DocumentContextParameter')]" mode="svrl" priority="175">
  <xsl:if test="not(not(ram:Value))">
    <svrl:failed-assert id="CII-SR-04" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-004] - Value should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedDocumentVersion))">
    <svrl:failed-assert id="CII-SR-05" flag="warning" location="saxon:path()">
      <svrl:text>[CII-SR-005] - SpecifiedDocumentVersion should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: /rsm:CrossIndustryInvoice/rsm:ExchangedDocumentContext/ram:GuidelineSpecifiedDocumentContextParameter/ram:ID |            /rsm:CrossIndustryInvoice/rsm:ExchangedDocument/ram:ID |            /rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem/ram:AssociatedDocumentLineDocument/ram:LineID |            /rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedTradeProduct/ram:SellerAssignedID [EN16931-CII-Syntax] -->
<xsl:template match="/rsm:CrossIndustryInvoice/rsm:ExchangedDocumentContext/ram:GuidelineSpecifiedDocumentContextParameter/ram:ID |            /rsm:CrossIndustryInvoice/rsm:ExchangedDocument/ram:ID |            /rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem/ram:AssociatedDocumentLineDocument/ram:LineID |            /rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedTradeProduct/ram:SellerAssignedID" mode="svrl" priority="176">
  <xsl:if test="not(not(@schemeName))">
    <svrl:failed-assert id="CII-DT-001" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-001] - schemeName should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(@schemeAgencyName))">
    <svrl:failed-assert id="CII-DT-002" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-002] - schemeAgencyName should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(@schemeDataURI))">
    <svrl:failed-assert id="CII-DT-003" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-003] - schemeDataURI should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(@schemeURI))">
    <svrl:failed-assert id="CII-DT-004" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-004] - schemeURI should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(@schemeID))">
    <svrl:failed-assert id="CII-DT-005" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-005] - schemeID should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(@schemeAgencyID))">
    <svrl:failed-assert id="CII-DT-006" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-006] - schemeAgencyID should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(@schemeVersionID))">
    <svrl:failed-assert id="CII-DT-007" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-007] - schemeVersionID should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:*[ends-with(name(), 'ID')] [EN16931-CII-Syntax] -->
<xsl:template match="ram:*[ends-with(name(), 'ID')]" mode="svrl" priority="177">
  <xsl:if test="not(not(@schemeName))">
    <svrl:failed-assert id="CII-DT-101" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-101] - schemeName should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(@schemeAgencyName))">
    <svrl:failed-assert id="CII-DT-102" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-102] - schemeAgencyName should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(@schemeDataURI))">
    <svrl:failed-assert id="CII-DT-103" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-103] - schemeDataURI should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(@schemeURI))">
    <svrl:failed-assert id="CII-DT-104" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-104] - schemeURI should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:TypeCode [EN16931-CII-Syntax] -->
<xsl:template match="ram:TypeCode" mode="svrl" priority="178">
  <xsl:if test="not(not(@name))">
    <svrl:failed-assert id="CII-DT-008" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-008] - name should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(@listURI))">
    <svrl:failed-assert id="CII-DT-009" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-009] - listURI should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: /rsm:CrossIndustryInvoice/rsm:ExchangedDocument/ram:TypeCode [EN16931-CII-Syntax] -->
<xsl:template match="/rsm:CrossIndustryInvoice/rsm:ExchangedDocument/ram:TypeCode" mode="svrl" priority="179">
  <xsl:if test="not(not(@listID))">
    <svrl:failed-assert id="CII-DT-010" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-010] - listID should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(@listAgencyID))">
    <svrl:failed-assert id="CII-DT-011" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-011] - listAgencyID should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(@listVersionID))">
    <svrl:failed-assert id="CII-DT-012" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-012] - listVersionID should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: /rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax/ram:CategoryCode [EN16931-CII-Syntax] -->
<xsl:template match="/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax/ram:CategoryCode" mode="svrl" priority="180">
  <xsl:if test="not(not(@listID))">
    <svrl:failed-assert id="CII-DT-045" flag="warning" location="saxon:path()">
      <svrl:text>[CII-DT-045] - @listID should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(@listAgencyID))">
    <svrl:failed-assert id="CII-DT-046" flag="warning" location="saxon:path()">
      <svrl:text>[CII-DT-046] - @listAgencyID should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(@listVersionID))">
    <svrl:failed-assert id="CII-DT-047" flag="warning" location="saxon:path()">
      <svrl:text>[CII-DT-047] - @listVersionID should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(@listURI))">
    <svrl:failed-assert id="CII-DT-048" flag="warning" location="saxon:path()">
      <svrl:text>[CII-DT-048] - @listURI should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:*[ends-with(name(), 'ReferencedDocument')] [EN16931-CII-Syntax] -->
<xsl:template match="ram:*[ends-with(name(), 'ReferencedDocument')]" mode="svrl" priority="181">
  <xsl:if test="not(not(ram:URIID) or (self::ram:AdditionalReferencedDocument and ram:TypeCode='916'))">
    <svrl:failed-assert id="CII-DT-015" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-015] - URIID should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:StatusCode))">
    <svrl:failed-assert id="CII-DT-016" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-016] - StatusCode should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:CopyIndicator))">
    <svrl:failed-assert id="CII-DT-017" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-017] - CopyIndicator should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:TypeCode) or (self::ram:AdditionalReferencedDocument) and (ram:TypeCode='50' or ram:TypeCode='130' or ram:TypeCode='916'))">
    <svrl:failed-assert id="CII-DT-018" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-018] - TypeCode should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:GlobalID))">
    <svrl:failed-assert id="CII-DT-019" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-019] - GlobalID should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:RevisionID))">
    <svrl:failed-assert id="CII-DT-020" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-020] - RevisionID should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:Name) or (self::ram:AdditionalReferencedDocument and ram:TypeCode='916'))">
    <svrl:failed-assert id="CII-DT-021" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-021] - Name should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:AttachmentBinaryObject) or (self::ram:AdditionalReferencedDocument and ram:TypeCode='916'))">
    <svrl:failed-assert id="CII-DT-022" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-022] - AttachmentBinaryObject should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:Information))">
    <svrl:failed-assert id="CII-DT-023" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-023] - Information should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ReferenceTypeCode) or (self::ram:AdditionalReferencedDocument and ram:TypeCode='130'))">
    <svrl:failed-assert id="CII-DT-024" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-024] - ReferenceTypeCode should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SectionName))">
    <svrl:failed-assert id="CII-DT-025" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-025] - SectionName should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:PreviousRevisionID))">
    <svrl:failed-assert id="CII-DT-026" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-026] - PreviousRevisionID should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:FormattedIssueDateTime) or self::ram:InvoiceReferencedDocument)">
    <svrl:failed-assert id="CII-DT-027" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-027] - FormattedIssueDateTime should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:EffectiveSpecifiedPeriod))">
    <svrl:failed-assert id="CII-DT-028" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-028] - EffectiveSpecifiedPeriod should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:IssuerTradeParty))">
    <svrl:failed-assert id="CII-DT-029" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-029] - IssuerTradeParty should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:AttachedSpecifiedBinaryFile))">
    <svrl:failed-assert id="CII-DT-030" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-030] - AttachedSpecifiedBinaryFile should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:*[ends-with(name(), 'Amount') and not (self::ram:TaxTotalAmount)] [EN16931-CII-Syntax] -->
<xsl:template match="ram:*[ends-with(name(), 'Amount') and not (self::ram:TaxTotalAmount)]" mode="svrl" priority="182">
  <xsl:if test="not(not(@currencyID))">
    <svrl:failed-assert id="CII-DT-031" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-031] - currencyID should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(@currencyCodeListVersionID))">
    <svrl:failed-assert id="CII-DT-032" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-032] - currencyCodeListVersionID should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:*[ends-with(name(), 'Quantity')] [EN16931-CII-Syntax] -->
<xsl:template match="ram:*[ends-with(name(), 'Quantity')]" mode="svrl" priority="183">
  <xsl:if test="not(not(@unitCode) or (/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeDelivery/ram:BilledQuantity/@unitCode))">
    <svrl:failed-assert id="CII-DT-033" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-033] - unitCode should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(@unitCodeListID))">
    <svrl:failed-assert id="CII-DT-034" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-034] - unitCodeListID should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(@unitCodeListAgencyID))">
    <svrl:failed-assert id="CII-DT-035" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-035] - unitCodeListAgencyID should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(@unitCodeListAgencyName))">
    <svrl:failed-assert id="CII-DT-036" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-036] - unitCodeListAgencyName should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:*[ends-with(name(), 'TradeTax')] [EN16931-CII-Syntax] -->
<xsl:template match="ram:*[ends-with(name(), 'TradeTax')]" mode="svrl" priority="184">
  <xsl:if test="not(not(ram:TypeCode) or (ram:TypeCode = 'VAT'))">
    <svrl:failed-assert id="CII-DT-037" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-037] - TypeCode shall be 'VAT'</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:CalculatedRate))">
    <svrl:failed-assert id="CII-DT-038" flag="warning" location="saxon:path()">
      <svrl:text>[CII-DT-038] - CalculatedRate should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:CalculationSequenceNumeric))">
    <svrl:failed-assert id="CII-DT-039" flag="warning" location="saxon:path()">
      <svrl:text>[CII-DT-039] - CalculationSequenceNumeric should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:BasisQuantity))">
    <svrl:failed-assert id="CII-DT-040" flag="warning" location="saxon:path()">
      <svrl:text>[CII-DT-040] - BasisQuantity should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:BasisAmount) or (ancestor::ram:ApplicableHeaderTradeSettlement))">
    <svrl:failed-assert id="CII-DT-041" flag="warning" location="saxon:path()">
      <svrl:text>[CII-DT-041] - BasisAmount should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:UnitBasisAmount))">
    <svrl:failed-assert id="CII-DT-042" flag="warning" location="saxon:path()">
      <svrl:text>[CII-DT-042] - UnitBasisAmount should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:LineTotalBasisAmount))">
    <svrl:failed-assert id="CII-DT-043" flag="warning" location="saxon:path()">
      <svrl:text>[CII-DT-043] - LineTotalBasisAmount should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:AllowanceChargeBasisAmount))">
    <svrl:failed-assert id="CII-DT-044" flag="warning" location="saxon:path()">
      <svrl:text>[CII-DT-044] - AllowanceChargeBasisAmount should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:CurrencyCode))">
    <svrl:failed-assert id="CII-DT-049" flag="warning" location="saxon:path()">
      <svrl:text>[CII-DT-049] - CurrencyCode should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:Jurisdiction))">
    <svrl:failed-assert id="CII-DT-050" flag="warning" location="saxon:path()">
      <svrl:text>[CII-DT-050] - Jurisdiction should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:CustomsDutyIndicator))">
    <svrl:failed-assert id="CII-DT-051" flag="warning" location="saxon:path()">
      <svrl:text>[CII-DT-051] - CustomsDutyIndicator should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ExemptionReasonCode) or self::ram:ApplicableTradeTax)">
    <svrl:failed-assert id="CII-DT-052" flag="warning" location="saxon:path()">
      <svrl:text>[CII-DT-052] - ExemptionReasonCode should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ExemptionReason) or self::ram:ApplicableTradeTax)">
    <svrl:failed-assert id="CII-DT-098" flag="warning" location="saxon:path()">
      <svrl:text>[CII-DT-098] - ExemptionReason should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:TaxBasisAllowanceRate))">
    <svrl:failed-assert id="CII-DT-053" flag="warning" location="saxon:path()">
      <svrl:text>[CII-DT-053] - TaxBasisAllowanceRate should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:TaxPointDate)  or (ancestor::ram:ApplicableHeaderTradeSettlement))">
    <svrl:failed-assert id="CII-DT-054" flag="warning" location="saxon:path()">
      <svrl:text>[CII-DT-054] - TaxPointDate should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:Type))">
    <svrl:failed-assert id="CII-DT-055" flag="warning" location="saxon:path()">
      <svrl:text>[CII-DT-055] - Type should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:InformationAmount))">
    <svrl:failed-assert id="CII-DT-056" flag="warning" location="saxon:path()">
      <svrl:text>[CII-DT-056] - InformationAmount should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:CategoryName))">
    <svrl:failed-assert id="CII-DT-057" flag="warning" location="saxon:path()">
      <svrl:text>[CII-DT-057] - CategoryName should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:DueDateTypeCode) or (ancestor::ram:ApplicableHeaderTradeSettlement))">
    <svrl:failed-assert id="CII-DT-058" flag="warning" location="saxon:path()">
      <svrl:text>[CII-DT-058] - DueDateTypeCode should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:RateApplicablePercent/@format))">
    <svrl:failed-assert id="CII-DT-059" flag="warning" location="saxon:path()">
      <svrl:text>[CII-DT-059] - @format should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SpecifiedTradeAccountingAccount))">
    <svrl:failed-assert id="CII-DT-060" flag="warning" location="saxon:path()">
      <svrl:text>[CII-DT-060] - SpecifiedTradeAccountingAccount should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ServiceSupplyTradeCountry))">
    <svrl:failed-assert id="CII-DT-061" flag="warning" location="saxon:path()">
      <svrl:text>[CII-DT-061] - ServiceSupplyTradeCountry should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:BuyerRepayableTaxSpecifiedTradeAccountingAccount))">
    <svrl:failed-assert id="CII-DT-062" flag="warning" location="saxon:path()">
      <svrl:text>[CII-DT-062] - BuyerRepayableTaxSpecifiedTradeAccountingAccount should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SellerPayableTaxSpecifiedTradeAccountingAccount))">
    <svrl:failed-assert id="CII-DT-063" flag="warning" location="saxon:path()">
      <svrl:text>[CII-DT-063] - SellerPayableTaxSpecifiedTradeAccountingAccount should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SellerRefundableTaxSpecifiedTradeAccountingAccount))">
    <svrl:failed-assert id="CII-DT-064" flag="warning" location="saxon:path()">
      <svrl:text>[CII-DT-064] - SellerRefundableTaxSpecifiedTradeAccountingAccount should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:BuyerDeductibleTaxSpecifiedTradeAccountingAccount))">
    <svrl:failed-assert id="CII-DT-065" flag="warning" location="saxon:path()">
      <svrl:text>[CII-DT-065] - BuyerDeductibleTaxSpecifiedTradeAccountingAccount should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:BuyerNonDeductibleTaxSpecifiedTradeAccountingAccount))">
    <svrl:failed-assert id="CII-DT-066" flag="warning" location="saxon:path()">
      <svrl:text>[CII-DT-066] - BuyerNonDeductibleTaxSpecifiedTradeAccountingAccount should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:PlaceApplicableTradeLocation))">
    <svrl:failed-assert id="CII-DT-067" flag="warning" location="saxon:path()">
      <svrl:text>[CII-DT-067] - PlaceApplicableTradeLocation should not be present</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:BillingSpecifiedPeriod [EN16931-CII-Syntax] -->
<xsl:template match="ram:BillingSpecifiedPeriod" mode="svrl" priority="185">
  <xsl:if test="not(not(ram:StartDateTime/udt:DateTime))">
    <svrl:failed-assert id="CII-DT-068" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-068] - DateTime shall not be used.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:DurationMeasure))">
    <svrl:failed-assert id="CII-DT-069" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-069] - DurationMeasure shall not be used.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:InclusiveIndicator))">
    <svrl:failed-assert id="CII-DT-070" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-070] - InclusiveIndicator shall not be used.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:Description))">
    <svrl:failed-assert id="CII-DT-071" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-071] - Description shall not be used.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:EndDateTime/udt:DateTime))">
    <svrl:failed-assert id="CII-DT-072" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-072] - DateTime shall not be used.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:CompleteDateTime))">
    <svrl:failed-assert id="CII-DT-073" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-073] - CompleteDateTime shall not be used.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:OpenIndicator))">
    <svrl:failed-assert id="CII-DT-074" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-074] - OpenIndicator shall not be used.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SeasonCode))">
    <svrl:failed-assert id="CII-DT-075" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-075] - SeasonCode shall not be used.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ID))">
    <svrl:failed-assert id="CII-DT-076" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-076] - ID shall not be used.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:Name))">
    <svrl:failed-assert id="CII-DT-077" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-077] - Name shall not be used.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:SequenceNumeric))">
    <svrl:failed-assert id="CII-DT-078" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-078] - SequenceNumeric shall not be used.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:StartDateFlexibilityCode))">
    <svrl:failed-assert id="CII-DT-079" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-079] - StartDateFlexibilityCode shall not be used.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:ContinuousIndicator))">
    <svrl:failed-assert id="CII-DT-080" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-080] - ContinuousIndicator shall not be used.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:PurposeCode))">
    <svrl:failed-assert id="CII-DT-081" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-081] - PurposeCode shall not be used.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:PostalTradeAddress [EN16931-CII-Syntax] -->
<xsl:template match="ram:PostalTradeAddress" mode="svrl" priority="186">
  <xsl:if test="not(not(ram:ID))">
    <svrl:failed-assert id="CII-DT-082" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-082] - ID shall not be used.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:PostOfficeBox))">
    <svrl:failed-assert id="CII-DT-083" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-083] - PostOfficeBox shall not be used.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:BuildingName))">
    <svrl:failed-assert id="CII-DT-084" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-084] - BuildingName shall not be used.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:LineFour))">
    <svrl:failed-assert id="CII-DT-086" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-086] - LineFour shall not be used.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:LineFive))">
    <svrl:failed-assert id="CII-DT-087" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-087] - LineFive shall not be used.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:StreetName))">
    <svrl:failed-assert id="CII-DT-088" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-088] - StreetName shall not be used.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:CitySubDivisionName))">
    <svrl:failed-assert id="CII-DT-089" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-089] - CitySubDivisionName shall not be used.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:CountryName))">
    <svrl:failed-assert id="CII-DT-090" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-090] - CountryName shall not be used.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:CountrySubDivisionID))">
    <svrl:failed-assert id="CII-DT-091" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-091] - CountrySubDivisionID shall not be used.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:AttentionOf))">
    <svrl:failed-assert id="CII-DT-092" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-092] - AttentionOf shall not be used.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:CareOf))">
    <svrl:failed-assert id="CII-DT-093" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-093] - CareOf shall not be used.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:BuildingNumber))">
    <svrl:failed-assert id="CII-DT-094" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-094] - BuildingNumber shall not be used.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:DepartmentName))">
    <svrl:failed-assert id="CII-DT-095" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-095] - DepartmentName shall not be used.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:if test="not(not(ram:AdditionalStreetName))">
    <svrl:failed-assert id="CII-DT-096" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-096] - AdditionalStreetName shall not be used.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: udt:DateTimeString[@format = '102'] [EN16931-CII-Syntax] -->
<xsl:template match="udt:DateTimeString[@format = '102']" mode="svrl" priority="187">
  <xsl:if test="not(matches(.,'^\s*(\d{4})(1[0-2]|0[1-9]){1}(3[01]|[12][0-9]|0[1-9]){1}\s*$'))">
    <svrl:failed-assert id="CII-DT-097" flag="fatal" location="saxon:path()">
      <svrl:text>[CII-DT-097] - Date time string with format attribute 102 shall be YYYYMMDD.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: rsm:ExchangedDocument/ram:TypeCode [EN16931-Codes] -->
<xsl:template match="rsm:ExchangedDocument/ram:TypeCode" mode="svrl" priority="188">
  <xsl:if test="not(((not(contains(normalize-space(.), ' ')) and contains(' 71 80 81 82 83 84 102 130 202 203 204 211 218 219 261 262 295 296 308 325 326 331 380 381 382 383 384 385 386 387 388 389 390 393 394 395 396 420 456 457 458 471 472 473 500 501 502 503 527 532 553 575 623 633 751 780 817 870 875 876 877 935 ', concat(' ', normalize-space(.), ' ')))))">
    <svrl:failed-assert id="BR-CL-01" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-CL-01]-The document type code MUST be coded by the invoice and credit note related code lists of UNTDID 1001.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:TaxTotalAmount[@currencyID] [EN16931-Codes] -->
<xsl:template match="ram:TaxTotalAmount[@currencyID]" mode="svrl" priority="189">
  <xsl:if test="not(((not(contains(normalize-space(@currencyID), ' ')) and contains(' AED AFN ALL AMD AOA ARS AUD AWG AZN BAM BBD BDT BHD BIF BMD BND BOB BOV BRL BSD BTN BWP BYN BZD CAD CDF CHE CHF CHW CLF CLP CNH CNY COP COU CRC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MXV MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE SOS SRD SSP STD SVC SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD USN UYI UYU UYW UZS VES VED VND VUV WST XAF XAG XAU XBA XBB XBC XBD XCD XCG XDR XOF XPD XPF XPT XSU XTS XUA XXX YER ZAR ZMW ZWG ', concat(' ', normalize-space(@currencyID), ' ')))))">
    <svrl:failed-assert id="BR-CL-03" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-CL-03]-currencyID MUST be coded using ISO code list 4217 alpha-3</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:InvoiceCurrencyCode [EN16931-Codes] -->
<xsl:template match="ram:InvoiceCurrencyCode" mode="svrl" priority="190">
  <xsl:if test="not(((not(contains(normalize-space(.), ' ')) and contains(' AED AFN ALL AMD AOA ARS AUD AWG AZN BAM BBD BDT BHD BIF BMD BND BOB BOV BRL BSD BTN BWP BYN BZD CAD CDF CHE CHF CHW CLF CLP CNH CNY COP COU CRC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MXV MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE SOS SRD SSP STD SVC SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD USN UYI UYU UYW UZS VES VED VND VUV WST XAF XAG XAU XBA XBB XBC XBD XCD XCG XDR XOF XPD XPF XPT XSU XTS XUA XXX YER ZAR ZMW ZWG ', concat(' ', normalize-space(.), ' ')))))">
    <svrl:failed-assert id="BR-CL-04" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-CL-04]-Invoice currency code MUST be coded using ISO code list 4217 alpha-3</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:TaxCurrencyCode [EN16931-Codes] -->
<xsl:template match="ram:TaxCurrencyCode" mode="svrl" priority="191">
  <xsl:if test="not(((not(contains(normalize-space(.), ' ')) and contains(' AED AFN ALL AMD AOA ARS AUD AWG AZN BAM BBD BDT BHD BIF BMD BND BOB BOV BRL BSD BTN BWP BYN BZD CAD CDF CHE CHF CHW CLF CLP CNH CNY COP COU CRC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS GIP GMD GNF GTQ GYD HKD HNL HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MXV MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD SCR SDG SEK SGD SHP SLE SOS SRD SSP STD SVC SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS UAH UGX USD USN UYI UYU UYW UZS VES VED VND VUV WST XAF XAG XAU XBA XBB XBC XBD XCD XCG XDR XOF XPD XPF XPT XSU XTS XUA XXX YER ZAR ZMW ZWG ', concat(' ', normalize-space(.), ' ')))))">
    <svrl:failed-assert id="BR-CL-05" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-CL-05]-Tax currency code MUST be coded using ISO code list 4217 alpha-3</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:DueDateTypeCode [EN16931-Codes] -->
<xsl:template match="ram:DueDateTypeCode" mode="svrl" priority="192">
  <xsl:if test="not(((not(contains(normalize-space(.), ' ')) and contains(' 5 29 72 ', concat(' ', normalize-space(.), ' ')))))">
    <svrl:failed-assert id="BR-CL-06" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-CL-06]-Value added tax point date code MUST be coded using a restriction of UNTDID 2475.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:ReferenceTypeCode [EN16931-Codes] -->
<xsl:template match="ram:ReferenceTypeCode" mode="svrl" priority="193">
  <xsl:if test="not(((not(contains(normalize-space(.), ' ')) and contains(' AAA AAB AAC AAD AAE AAF AAG AAH AAI AAJ AAK AAL AAM AAN AAO AAP AAQ AAR AAS AAT AAU AAV AAW AAX AAY AAZ ABA ABB ABC ABD ABE ABF ABG ABH ABI ABJ ABK ABL ABM ABN ABO ABP ABQ ABR ABS ABT ABU ABV ABW ABX ABY ABZ AC ACA ACB ACC ACD ACE ACF ACG ACH ACI ACJ ACK ACL ACN ACO ACP ACQ ACR ACT ACU ACV ACW ACX ACY ACZ ADA ADB ADC ADD ADE ADF ADG ADI ADJ ADK ADL ADM ADN ADO ADP ADQ ADT ADU ADV ADW ADX ADY ADZ AE AEA AEB AEC AED AEE AEF AEG AEH AEI AEJ AEK AEL AEM AEN AEO AEP AEQ AER AES AET AEU AEV AEW AEX AEY AEZ AF AFA AFB AFC AFD AFE AFF AFG AFH AFI AFJ AFK AFL AFM AFN AFO AFP AFQ AFR AFS AFT AFU AFV AFW AFX AFY AFZ AGA AGB AGC AGD AGE AGF AGG AGH AGI AGJ AGK AGL AGM AGN AGO AGP AGQ AGR AGS AGT AGU AGV AGW AGX AGY AGZ AHA AHB AHC AHD AHE AHF AHG AHH AHI AHJ AHK AHL AHM AHN AHO AHP AHQ AHR AHS AHT AHU AHV AHX AHY AHZ AIA AIB AIC AID AIE AIF AIG AIH AII AIJ AIK AIL AIM AIN AIO AIP AIQ AIR AIS AIT AIU AIV AIW AIX AIY AIZ AJA AJB AJC AJD AJE AJF AJG AJH AJI AJJ AJK AJL AJM AJN AJO AJP AJQ AJR AJS AJT AJU AJV AJW AJX AJY AJZ AKA AKB AKC AKD AKE AKF AKG AKH AKI AKJ AKK AKL AKM AKN AKO AKP AKQ AKR AKS AKT AKU AKV AKW AKX AKY AKZ ALA ALB ALC ALD ALE ALF ALG ALH ALI ALJ ALK ALL ALM ALN ALO ALP ALQ ALR ALS ALT ALU ALV ALW ALX ALY ALZ AMA AMB AMC AMD AME AMF AMG AMH AMI AMJ AMK AML AMM AMN AMO AMP AMQ AMR AMS AMT AMU AMV AMW AMX AMY AMZ ANA ANB ANC AND ANE ANF ANG ANH ANI ANJ ANK ANL ANM ANN ANO ANP ANQ ANR ANS ANT ANU ANV ANW ANX ANY AOA AOD AOE AOF AOG AOH AOI AOJ AOK AOL AOM AON AOO AOP AOQ AOR AOS AOT AOU AOV AOW AOX AOY AOZ AP APA APB APC APD APE APF APG APH API APJ APK APL APM APN APO APP APQ APR APS APT APU APV APW APX APY APZ AQA AQB AQC AQD AQE AQF AQG AQH AQI AQJ AQK AQL AQM AQN AQO AQP AQQ AQR AQS AQT AQU AQV AQW AQX AQY AQZ ARA ARB ARC ARD ARE ARF ARG ARH ARI ARJ ARK ARL ARM ARN ARO ARP ARQ ARR ARS ART ARU ARV ARW ARX ARY ARZ ASA ASB ASC ASD ASE ASF ASG ASH ASI ASJ ASK ASL ASM ASN ASO ASP ASQ ASR ASS AST ASU ASV ASW ASX ASY ASZ ATA ATB ATC ATD ATE ATF ATG ATH ATI ATJ ATK ATL ATM ATN ATO ATP ATQ ATR ATS ATT ATU ATV ATW ATX ATY ATZ AU AUA AUB AUC AUD AUE AUF AUG AUH AUI AUJ AUK AUL AUM AUN AUO AUP AUQ AUR AUS AUT AUU AUV AUW AUX AUY AUZ AV AVA AVB AVC AVD AVE AVF AVG AVH AVI AVJ AVK AVL AVM AVN AVO AVP AVQ AVR AVS AVT AVU AVV AVW AVX AVY AVZ AWA AWB AWC AWD AWE AWF AWG AWH AWI AWJ AWK AWL AWM AWN AWO AWP AWQ AWR AWS AWT AWU AWV AWW AWX AWY AWZ AXA AXB AXC AXD AXE AXF AXG AXH AXI AXJ AXK AXL AXM AXN AXO AXP AXQ AXR AXS AXU BA BC BD BE BH BM BN BO BR BT BTP BW CAS CAT CAU CAV CAW CAX CAY CAZ CBA CBB CD CEC CED CFE CFF CFO CG CH CK CKN CM CMR CN CNO COF CP CR CRN CS CST CT CU CV CW CZ DA DAN DB DI DL DM DQ DR EA EB ED EE EEP EI EN EQ ER ERN ET EX FC FF FI FLW FN FO FS FT FV FX GA GC GD GDN GN HS HWB IA IB ICA ICE ICO II IL INB INN INO IP IS IT IV JB JE LA LAN LAR LB LC LI LO LRC LS MA MB MF MG MH MR MRN MS MSS MWB NA NF OH OI ON OP OR PB PC PD PE PF PI PK PL POR PP PQ PR PS PW PY RA RC RCN RE REN RF RR RT SA SB SD SE SEA SF SH SI SM SN SP SQ SRN SS STA SW SZ TB TCR TE TF TI TIN TL TN TP UAR UC UCN UN UO URI VA VC VGR VM VN VON VOR VP VR VS VT VV WE WM WN WR WS WY XA XC XP ZZZ ', concat(' ', normalize-space(.), ' ')))))">
    <svrl:failed-assert id="BR-CL-07" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-CL-07]-Object identifier identification scheme identifier MUST be coded using a restriction of UNTDID 1153.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:SubjectCode [EN16931-Codes] -->
<xsl:template match="ram:SubjectCode" mode="svrl" priority="194">
  <xsl:if test="not(((not(contains(normalize-space(.), ' ')) and contains(' AAA AAB AAC AAD AAE AAF AAG AAI AAJ AAK AAL AAM AAN AAO AAP AAQ AAR AAS AAT AAU AAV AAW AAX AAY AAZ ABA ABB ABC ABD ABE ABF ABG ABH ABI ABJ ABK ABL ABM ABN ABO ABP ABQ ABR ABS ABT ABU ABV ABW ABX ABZ ACA ACB ACC ACD ACE ACF ACG ACH ACI ACJ ACK ACL ACM ACN ACO ACP ACQ ACR ACS ACT ACU ACV ACW ACX ACY ACZ ADA ADB ADC ADD ADE ADF ADG ADH ADI ADJ ADK ADL ADM ADN ADO ADP ADQ ADR ADS ADT ADU ADV ADW ADX ADY ADZ AEA AEB AEC AED AEE AEF AEG AEH AEI AEJ AEK AEL AEM AEN AEO AEP AEQ AER AES AET AEU AEV AEW AEX AEY AEZ AFA AFB AFC AFD AFE AFF AFG AFH AFI AFJ AFK AFL AFM AFN AFO AFP AFQ AFR AFS AFT AFU AFV AFW AFX AFY AFZ AGA AGB AGC AGD AGE AGF AGG AGH AGI AGJ AGK AGL AGM AGN AGO AGP AGQ AGR AGS AGT AGU AGV AGW AGX AGY AGZ AHA AHB AHC AHD AHE AHF AHG AHH AHI AHJ AHK AHL AHM AHN AHO AHP AHQ AHR AHS AHT AHU AHV AHW AHX AHY AHZ AIA AIB AIC AID AIE AIF AIG AIH AII AIJ AIK AIL AIM AIN AIO AIP AIQ AIR AIS AIT AIU AIV AIW AIX AIY AIZ AJA AJB ALC ALD ALE ALF ALG ALH ALI ALJ ALK ALL ALM ALN ALO ALP ALQ ARR ARS AUT AUU AUV AUW AUX AUY AUZ AVA AVB AVC AVD AVE AVF BAG BAH BAI BAJ BAK BAL BAM BAN BAO BAP BAQ BAR BAS BAT BAU BAV BAW BAX BAY BAZ BBA BBB BLC BLD BLE BLF BLG BLH BLI BLJ BLK BLL BLM BLN BLO BLP BLQ BLR BLS BLT BLU BLV BLW BLX BLY BLZ BMA BMB BMC BMD BME BMF BMG BMH CCI CCJ CCK CCL CCM CCN CCO CEX CHG CIP CLP CLR COI CUR CUS DAR DCL DEL DIN DOC DUT EUR FBC GBL GEN GS7 HAN HAZ ICN IIN IMI IND INS INV IRP ITR ITS LAN LIN LOI MCO MDH MKS ORI OSI PAC PAI PAY PKG PKT PMD PMT PRD PRF PRI PUR QIN QQD QUT RAH REG RET REV RQR SAF SIC SIN SLR SPA SPG SPH SPP SPT SRN SSR SUR TCA TDT TRA TRR TXD WHI ZZZ ', concat(' ', normalize-space(.), ' ')))))">
    <svrl:failed-assert id="BR-CL-08" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-CL-08]-Subject Code MUST be coded using a restriction of UNTDID 4451.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:GlobalID[@schemeID][not(ancestor::ram:SpecifiedTradeProduct) and not(ancestor::ram:ShipToTradeParty)] [EN16931-Codes] -->
<xsl:template match="ram:GlobalID[@schemeID][not(ancestor::ram:SpecifiedTradeProduct) and not(ancestor::ram:ShipToTradeParty)]" mode="svrl" priority="195">
  <xsl:if test="not(((not(contains(normalize-space(@schemeID), ' ')) and contains(' 0002 0003 0004 0005 0006 0007 0008 0009 0010 0011 0012 0013 0014 0015 0016 0017 0018 0019 0020 0021 0022 0023 0024 0025 0026 0027 0028 0029 0030 0031 0032 0033 0034 0035 0036 0037 0038 0039 0040 0041 0042 0043 0044 0045 0046 0047 0048 0049 0050 0051 0052 0053 0054 0055 0056 0057 0058 0059 0060 0061 0062 0063 0064 0065 0066 0067 0068 0069 0070 0071 0072 0073 0074 0075 0076 0077 0078 0079 0080 0081 0082 0083 0084 0085 0086 0087 0088 0089 0090 0091 0093 0094 0095 0096 0097 0098 0099 0100 0101 0102 0104 0105 0106 0107 0108 0109 0110 0111 0112 0113 0114 0115 0116 0117 0118 0119 0120 0121 0122 0123 0124 0125 0126 0127 0128 0129 0130 0131 0132 0133 0134 0135 0136 0137 0138 0139 0140 0141 0142 0143 0144 0145 0146 0147 0148 0149 0150 0151 0152 0153 0154 0155 0156 0157 0158 0159 0160 0161 0162 0163 0164 0165 0166 0167 0168 0169 0170 0171 0172 0173 0174 0175 0176 0177 0178 0179 0180 0183 0184 0185 0186 0187 0188 0189 0190 0191 0192 0193 0194 0195 0196 0197 0198 0199 0200 0201 0202 0203 0204 0205 0206 0207 0208 0209 0210 0211 0212 0213 0214 0215 0216 0217 0218 0219 0220 0221 0222 0223 0224 0225 0226 0227 0228 0229 0230 0231 0232 0233 0234 0235 0236 0237 0238 0239 0240 0241 0242 0243 0244 0245 0246 0247 0248 ', concat(' ', normalize-space(@schemeID), ' ')))))">
    <svrl:failed-assert id="BR-CL-10" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-CL-10]-Any identifier identification scheme identifier MUST be coded using one of the ISO 6523 ICD list.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:ID[@schemeID][not(ancestor::ram:SpecifiedTaxRegistration)] [EN16931-Codes] -->
<xsl:template match="ram:ID[@schemeID][not(ancestor::ram:SpecifiedTaxRegistration)]" mode="svrl" priority="196">
  <xsl:if test="not(((not(contains(normalize-space(@schemeID), ' ')) and contains(' 0002 0003 0004 0005 0006 0007 0008 0009 0010 0011 0012 0013 0014 0015 0016 0017 0018 0019 0020 0021 0022 0023 0024 0025 0026 0027 0028 0029 0030 0031 0032 0033 0034 0035 0036 0037 0038 0039 0040 0041 0042 0043 0044 0045 0046 0047 0048 0049 0050 0051 0052 0053 0054 0055 0056 0057 0058 0059 0060 0061 0062 0063 0064 0065 0066 0067 0068 0069 0070 0071 0072 0073 0074 0075 0076 0077 0078 0079 0080 0081 0082 0083 0084 0085 0086 0087 0088 0089 0090 0091 0093 0094 0095 0096 0097 0098 0099 0100 0101 0102 0104 0105 0106 0107 0108 0109 0110 0111 0112 0113 0114 0115 0116 0117 0118 0119 0120 0121 0122 0123 0124 0125 0126 0127 0128 0129 0130 0131 0132 0133 0134 0135 0136 0137 0138 0139 0140 0141 0142 0143 0144 0145 0146 0147 0148 0149 0150 0151 0152 0153 0154 0155 0156 0157 0158 0159 0160 0161 0162 0163 0164 0165 0166 0167 0168 0169 0170 0171 0172 0173 0174 0175 0176 0177 0178 0179 0180 0183 0184 0185 0186 0187 0188 0189 0190 0191 0192 0193 0194 0195 0196 0197 0198 0199 0200 0201 0202 0203 0204 0205 0206 0207 0208 0209 0210 0211 0212 0213 0214 0215 0216 0217 0218 0219 0220 0221 0222 0223 0224 0225 0226 0227 0228 0229 0230 0231 0232 0233 0234 0235 0236 0237 0238 0239 0240 0241 0242 0243 0244 0245 0246 0247 0248 ', concat(' ', normalize-space(@schemeID), ' ')))))">
    <svrl:failed-assert id="BR-CL-11" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-CL-11]-Any registration identifier identification scheme identifier MUST be coded using one of the ISO 6523 ICD list.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:ClassCode[@listID] [EN16931-Codes] -->
<xsl:template match="ram:ClassCode[@listID]" mode="svrl" priority="197">
  <xsl:if test="not(((not(contains(normalize-space(@listID), ' ')) and contains(' AA AB AC AD AE AF AG AH AI AJ AK AL AM AN AO AP AQ AR AS AT AU AV AW AX AY AZ BA BB BC BD BE BF BG BH BI BJ BK BL BM BN BO BP BQ BR BS BT BU BV BW BX BY BZ CC CG CL CR CV DR DW EC EF EMD EN FS GB GN GMN GS HS IB IN IS IT IZ MA MF MN MP NB ON PD PL PO PPI PV QS RC RN RU RY SA SG SK SN SRS SRT SRU SRV SRW SRX SRY SRZ SS SSA SSB SSC SSD SSE SSF SSG SSH SSI SSJ SSK SSL SSM SSN SSO SSP SSQ SSR SSS SST SSU SSV SSW SSX SSY SSZ ST STA STB STC STD STE STF STG STH STI STJ STK STL STM STN STO STP STQ STR STS STT STU STV STW STX STY STZ SUA SUB SUC SUD SUE SUF SUG SUH SUI SUJ SUK SUL SUM TG TSN TSO TSP TSQ TSR TSS TST TSU UA UP VN VP VS VX ZZZ ', concat(' ', normalize-space(@listID), ' ')))))">
    <svrl:failed-assert id="BR-CL-13" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-CL-13]-Item classification identifier identification scheme identifier MUST be coded using one of the UNTDID 7143 list.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:CountryID [EN16931-Codes] -->
<xsl:template match="ram:CountryID" mode="svrl" priority="198">
  <xsl:if test="not(((not(contains(normalize-space(.), ' ')) and contains(' 1A AD AE AF AG AI AL AM AN AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BL BJ BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XI YE YT ZA ZM ZW ', concat(' ', normalize-space(.), ' ')))))">
    <svrl:failed-assert id="BR-CL-14" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-CL-14]-Country codes in an invoice MUST be coded using ISO code list 3166-1</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:OriginTradeCountry/ram:ID [EN16931-Codes] -->
<xsl:template match="ram:OriginTradeCountry/ram:ID" mode="svrl" priority="199">
  <xsl:if test="not(((not(contains(normalize-space(.), ' ')) and contains(' 1A AD AE AF AG AI AL AM AN AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BL BJ BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XI YE YT ZA ZM ZW ', concat(' ', normalize-space(.), ' ')))))">
    <svrl:failed-assert id="BR-CL-15" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-CL-15]-Country codes in an invoice MUST be coded using ISO code list 3166-1</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:SpecifiedTradeSettlementPaymentMeans/ram:TypeCode [EN16931-Codes] -->
<xsl:template match="ram:SpecifiedTradeSettlementPaymentMeans/ram:TypeCode" mode="svrl" priority="200">
  <xsl:if test="not(((not(contains(normalize-space(.), ' ')) and contains(' 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39 40 41 42 43 44 45 46 47 48 49 50 51 52 53 54 55 56 57 58 59 60 61 62 63 64 65 66 67 68 69 70 74 75 76 77 78 91 92 93 94 95 96 97 98 ZZZ ', concat(' ', normalize-space(.), ' ')))))">
    <svrl:failed-assert id="BR-CL-16" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-CL-16]-Payment means in an invoice MUST be coded using UNTDID 4461 code list</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:CategoryTradeTax/ram:CategoryCode [EN16931-Codes] -->
<xsl:template match="ram:CategoryTradeTax/ram:CategoryCode" mode="svrl" priority="201">
  <xsl:if test="not(((not(contains(normalize-space(.), ' ')) and contains(' AE L M E S Z G O K B ', concat(' ', normalize-space(.), ' ')))))">
    <svrl:failed-assert id="BR-CL-17" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-CL-17]-Invoice tax categories MUST be coded using UNCL 5305 code list</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:ApplicableTradeTax/ram:CategoryCode [EN16931-Codes] -->
<xsl:template match="ram:ApplicableTradeTax/ram:CategoryCode" mode="svrl" priority="202">
  <xsl:if test="not(((not(contains(normalize-space(.), ' ')) and contains(' AE L M E S Z G O K B ', concat(' ', normalize-space(.), ' ')))))">
    <svrl:failed-assert id="BR-CL-18" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-CL-18]-Invoice tax categories MUST be coded using UNCL 5305 code list</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator = false()]/ram:ReasonCode [EN16931-Codes] -->
<xsl:template match="ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator = false()]/ram:ReasonCode" mode="svrl" priority="203">
  <xsl:if test="not(((not(contains(normalize-space(.), ' ')) and contains(' 41 42 60 62 63 64 65 66 67 68 70 71 88 95 100 102 103 104 105 ', concat(' ', normalize-space(.), ' ')))))">
    <svrl:failed-assert id="BR-CL-19" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-CL-19]-Coded allowance reasons MUST belong to the UNCL 5189 code list</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator = true()]/ram:ReasonCode [EN16931-Codes] -->
<xsl:template match="ram:SpecifiedTradeAllowanceCharge[ram:ChargeIndicator/udt:Indicator = true()]/ram:ReasonCode" mode="svrl" priority="204">
  <xsl:if test="not(((not(contains(normalize-space(.), ' ')) and contains(' AA AAA AAC AAD AAE AAF AAH AAI AAS AAT AAV AAY AAZ ABA ABB ABC ABD ABF ABK ABL ABN ABR ABS ABT ABU ACF ACG ACH ACI ACJ ACK ACL ACM ACS ADC ADE ADJ ADK ADL ADM ADN ADO ADP ADQ ADR ADT ADW ADY ADZ AEA AEB AEC AED AEF AEH AEI AEJ AEK AEL AEM AEN AEO AEP AES AET AEU AEV AEW AEX AEY AEZ AJ AU CA CAB CAD CAE CAF CAI CAJ CAK CAL CAM CAN CAO CAP CAQ CAR CAS CAT CAU CAV CAW CAX CAY CAZ CD CG CS CT DAB DAD DAC DAF DAG DAH DAI DAJ DAK DAL DAM DAN DAO DAP DAQ DL EG EP ER FAA FAB FAC FC FH FI GAA HAA HD HH IAA IAB ID IF IR IS KO L1 LA LAA LAB LF MAE MI ML NAA OA PA PAA PC PL PRV RAB RAC RAD RAF RE RF RH RV SA SAA SAD SAE SAI SG SH SM SU TAB TAC TT TV V1 V2 WH XAA YY ZZZ ', concat(' ', normalize-space(.), ' ')))))">
    <svrl:failed-assert id="BR-CL-20" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-CL-20]-Coded charge reasons MUST belong to the UNCL 7161 code list</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:SpecifiedTradeProduct/ram:GlobalID[@schemeID] [EN16931-Codes] -->
<xsl:template match="ram:SpecifiedTradeProduct/ram:GlobalID[@schemeID]" mode="svrl" priority="205">
  <xsl:if test="not(((not(contains(normalize-space(@schemeID), ' ')) and contains(' 0002 0003 0004 0005 0006 0007 0008 0009 0010 0011 0012 0013 0014 0015 0016 0017 0018 0019 0020 0021 0022 0023 0024 0025 0026 0027 0028 0029 0030 0031 0032 0033 0034 0035 0036 0037 0038 0039 0040 0041 0042 0043 0044 0045 0046 0047 0048 0049 0050 0051 0052 0053 0054 0055 0056 0057 0058 0059 0060 0061 0062 0063 0064 0065 0066 0067 0068 0069 0070 0071 0072 0073 0074 0075 0076 0077 0078 0079 0080 0081 0082 0083 0084 0085 0086 0087 0088 0089 0090 0091 0093 0094 0095 0096 0097 0098 0099 0100 0101 0102 0104 0105 0106 0107 0108 0109 0110 0111 0112 0113 0114 0115 0116 0117 0118 0119 0120 0121 0122 0123 0124 0125 0126 0127 0128 0129 0130 0131 0132 0133 0134 0135 0136 0137 0138 0139 0140 0141 0142 0143 0144 0145 0146 0147 0148 0149 0150 0151 0152 0153 0154 0155 0156 0157 0158 0159 0160 0161 0162 0163 0164 0165 0166 0167 0168 0169 0170 0171 0172 0173 0174 0175 0176 0177 0178 0179 0180 0183 0184 0185 0186 0187 0188 0189 0190 0191 0192 0193 0194 0195 0196 0197 0198 0199 0200 0201 0202 0203 0204 0205 0206 0207 0208 0209 0210 0211 0212 0213 0214 0215 0216 0217 0218 0219 0220 0221 0222 0223 0224 0225 0226 0227 0228 0229 0230 0231 0232 0233 0234 0235 0236 0237 0238 0239 0240 0241 0242 0243 0244 0245 0246 0247 0248 ', concat(' ', normalize-space(@schemeID), ' ')))))">
    <svrl:failed-assert id="BR-CL-21" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-CL-21]-Item standard identifier scheme identifier MUST belong to the ISO 6523 ICD
      code list</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:ExemptionReasonCode [EN16931-Codes] -->
<xsl:template match="ram:ExemptionReasonCode" mode="svrl" priority="206">
  <xsl:if test="not(((not(contains(normalize-space(.), ' ')) and contains(' VATEX-EU-79-C VATEX-EU-132 VATEX-EU-132-1A VATEX-EU-132-1B VATEX-EU-132-1C VATEX-EU-132-1D VATEX-EU-132-1E VATEX-EU-132-1F VATEX-EU-132-1G VATEX-EU-132-1H VATEX-EU-132-1I VATEX-EU-132-1J VATEX-EU-132-1K VATEX-EU-132-1L VATEX-EU-132-1M VATEX-EU-132-1N VATEX-EU-132-1O VATEX-EU-132-1P VATEX-EU-132-1Q VATEX-EU-135-1 VATEX-EU-143 VATEX-EU-143-1A VATEX-EU-143-1B VATEX-EU-143-1C VATEX-EU-143-1D VATEX-EU-143-1E VATEX-EU-143-1F VATEX-EU-143-1FA VATEX-EU-143-1G VATEX-EU-143-1H VATEX-EU-143-1I VATEX-EU-143-1J VATEX-EU-143-1K VATEX-EU-143-1L VATEX-EU-144 VATEX-EU-146-1E VATEX-EU-159 VATEX-EU-309 VATEX-EU-148 VATEX-EU-148-A VATEX-EU-148-B VATEX-EU-148-C VATEX-EU-148-D VATEX-EU-148-E VATEX-EU-148-F VATEX-EU-148-G VATEX-EU-151 VATEX-EU-151-1A VATEX-EU-151-1AA VATEX-EU-151-1B VATEX-EU-151-1C VATEX-EU-151-1D VATEX-EU-151-1E VATEX-EU-G VATEX-EU-O VATEX-EU-IC VATEX-EU-AE VATEX-EU-D VATEX-EU-F VATEX-EU-I VATEX-EU-J VATEX-FR-FRANCHISE VATEX-FR-CNWVAT VATEX-EU-153 VATEX-FR-CGI261-1 VATEX-FR-CGI261-2 VATEX-FR-CGI261-3 VATEX-FR-CGI261-4 VATEX-FR-CGI261-5 VATEX-FR-CGI261-7 VATEX-FR-CGI261-8 VATEX-FR-CGI261A VATEX-FR-CGI261B VATEX-FR-CGI261C-1 VATEX-FR-CGI261C-2 VATEX-FR-CGI261C-3 VATEX-FR-CGI261D-1 VATEX-FR-CGI261D-1BIS VATEX-FR-CGI261D-2 VATEX-FR-CGI261D-3 VATEX-FR-CGI261D-4 VATEX-FR-CGI261E-1 VATEX-FR-CGI261E-2 VATEX-FR-CGI277A VATEX-FR-CGI275 VATEX-FR-298SEXDECIESA VATEX-FR-CGI295 VATEX-FR-AE ', concat(' ', normalize-space(upper-case(.)), ' ')))))">
    <svrl:failed-assert id="BR-CL-22" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-CL-22]-Tax exemption reason code identifier scheme identifier MUST belong to the CEF VATEX code list</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:BasisQuantity[@unitCode] | ram:BilledQuantity[@unitCode] [EN16931-Codes] -->
<xsl:template match="ram:BasisQuantity[@unitCode] | ram:BilledQuantity[@unitCode]" mode="svrl" priority="207">
  <xsl:if test="not(((not(contains(normalize-space(@unitCode), ' ')) and contains(' 10 11 13 14 15 20 21 22 23 24 25 27 28 33 34 35 37 38 40 41 56 57 58 59 60 61 74 77 80 81 85 87 89 91 1I 2A 2B 2C 2G 2H 2I 2J 2K 2L 2M 2N 2P 2Q 2R 2U 2X 2Y 2Z 3B 3C 4C 4G 4H 4K 4L 4M 4N 4O 4P 4Q 4R 4T 4U 4W 4X 5A 5B 5E 5J A10 A11 A12 A13 A14 A15 A16 A17 A18 A19 A2 A20 A21 A22 A23 A24 A26 A27 A28 A29 A3 A30 A31 A32 A33 A34 A35 A36 A37 A38 A39 A4 A40 A41 A42 A43 A44 A45 A47 A48 A49 A5 A53 A54 A55 A56 A59 A6 A68 A69 A7 A70 A71 A73 A74 A75 A76 A8 A84 A85 A86 A87 A88 A89 A9 A90 A91 A93 A94 A95 A96 A97 A98 A99 AA AB ACR ACT AD AE AH AI AK AL AMH AMP ANN APZ AQ AS ASM ASU ATM AWG AY AZ B1 B10 B11 B12 B13 B14 B15 B16 B17 B18 B19 B20 B21 B22 B23 B24 B25 B26 B27 B28 B29 B3 B30 B31 B32 B33 B34 B35 B4 B41 B42 B43 B44 B45 B46 B47 B48 B49 B50 B52 B53 B54 B55 B56 B57 B58 B59 B60 B61 B62 B63 B64 B66 B67 B68 B69 B7 B70 B71 B72 B73 B74 B75 B76 B77 B78 B79 B8 B80 B81 B82 B83 B84 B85 B86 B87 B88 B89 B90 B91 B92 B93 B94 B95 B96 B97 B98 B99 BAR BB BFT BHP BIL BLD BLL BP BPM BQL BTU BUA BUI C0 C10 C11 C12 C13 C14 C15 C16 C17 C18 C19 C20 C21 C22 C23 C24 C25 C26 C27 C28 C29 C3 C30 C31 C32 C33 C34 C35 C36 C37 C38 C39 C40 C41 C42 C43 C44 C45 C46 C47 C48 C49 C50 C51 C52 C53 C54 C55 C56 C57 C58 C59 C60 C61 C62 C63 C64 C65 C66 C67 C68 C69 C7 C70 C71 C72 C73 C74 C75 C76 C78 C79 C8 C80 C81 C82 C83 C84 C85 C86 C87 C88 C89 C9 C90 C91 C92 C93 C94 C95 C96 C97 C99 CCT CDL CEL CEN CG CGM CKG CLF CLT CMK CMQ CMT CNP CNT COU CTG CTM CTN CUR CWA CWI D03 D04 D1 D10 D11 D12 D13 D15 D16 D17 D18 D19 D2 D20 D21 D22 D23 D24 D25 D26 D27 D29 D30 D31 D32 D33 D34 D36 D41 D42 D43 D44 D45 D46 D47 D48 D49 D5 D50 D51 D52 D53 D54 D55 D56 D57 D58 D59 D6 D60 D61 D62 D63 D65 D68 D69 D73 D74 D77 D78 D80 D81 D82 D83 D85 D86 D87 D88 D89 D91 D93 D94 D95 DAA DAD DAY DB DBM DBW DD DEC DG DJ DLT DMA DMK DMO DMQ DMT DN DPC DPR DPT DRA DRI DRL DT DTN DWT DZN DZP E01 E07 E08 E09 E10 E12 E14 E15 E16 E17 E18 E19 E20 E21 E22 E23 E25 E27 E28 E30 E31 E32 E33 E34 E35 E36 E37 E38 E39 E4 E40 E41 E42 E43 E44 E45 E46 E47 E48 E49 E50 E51 E52 E53 E54 E55 E56 E57 E58 E59 E60 E61 E62 E63 E64 E65 E66 E67 E68 E69 E70 E71 E72 E73 E74 E75 E76 E77 E78 E79 E80 E81 E82 E83 E84 E85 E86 E87 E88 E89 E90 E91 E92 E93 E94 E95 E96 E97 E98 E99 EA EB EQ F01 F02 F03 F04 F05 F06 F07 F08 F10 F11 F12 F13 F14 F15 F16 F17 F18 F19 F20 F21 F22 F23 F24 F25 F26 F27 F28 F29 F30 F31 F32 F33 F34 F35 F36 F37 F38 F39 F40 F41 F42 F43 F44 F45 F46 F47 F48 F49 F50 F51 F52 F53 F54 F55 F56 F57 F58 F59 F60 F61 F62 F63 F64 F65 F66 F67 F68 F69 F70 F71 F72 F73 F74 F75 F76 F77 F78 F79 F80 F81 F82 F83 F84 F85 F86 F87 F88 F89 F90 F91 F92 F93 F94 F95 F96 F97 F98 F99 FAH FAR FBM FC FF FH FIT FL FNU FOT FP FR FS FTK FTQ G01 G04 G05 G06 G08 G09 G10 G11 G12 G13 G14 G15 G16 G17 G18 G19 G2 G20 G21 G23 G24 G25 G26 G27 G28 G29 G3 G30 G31 G32 G33 G34 G35 G36 G37 G38 G39 G40 G41 G42 G43 G44 G45 G46 G47 G48 G49 G50 G51 G52 G53 G54 G55 G56 G57 G58 G59 G60 G61 G62 G63 G64 G65 G66 G67 G68 G69 G70 G71 G72 G73 G74 G75 G76 G77 G78 G79 G80 G81 G82 G83 G84 G85 G86 G87 G88 G89 G90 G91 G92 G93 G94 G95 G96 G97 G98 G99 GB GBQ GDW GE GF GFI GGR GIA GIC GII GIP GJ GL GLD GLI GLL GM GO GP GQ GRM GRN GRO GV GWH H03 H04 H05 H06 H07 H08 H09 H10 H11 H12 H13 H14 H15 H16 H18 H19 H20 H21 H22 H23 H24 H25 H26 H27 H28 H29 H30 H31 H32 H33 H34 H35 H36 H37 H38 H39 H40 H41 H42 H43 H44 H45 H46 H47 H48 H49 H50 H51 H52 H53 H54 H55 H56 H57 H58 H59 H60 H61 H62 H63 H64 H65 H66 H67 H68 H69 H70 H71 H72 H73 H74 H75 H76 H77 H79 H80 H81 H82 H83 H84 H85 H87 H88 H89 H90 H91 H92 H93 H94 H95 H96 H98 H99 HA HAD HBA HBX HC HDW HEA HGM HH HIU HKM HLT HM HMO HMQ HMT HPA HTZ HUR HWE IA IE INH INK INQ ISD IU IUG IV J10 J12 J13 J14 J15 J16 J17 J18 J19 J2 J20 J21 J22 J23 J24 J25 J26 J27 J28 J29 J30 J31 J32 J33 J34 J35 J36 J38 J39 J40 J41 J42 J43 J44 J45 J46 J47 J48 J49 J50 J51 J52 J53 J54 J55 J56 J57 J58 J59 J60 J61 J62 J63 J64 J65 J66 J67 J68 J69 J70 J71 J72 J73 J74 J75 J76 J78 J79 J81 J82 J83 J84 J85 J87 J90 J91 J92 J93 J95 J96 J97 J98 J99 JE JK JM JNT JOU JPS JWL K1 K10 K11 K12 K13 K14 K15 K16 K17 K18 K19 K2 K20 K21 K22 K23 K26 K27 K28 K3 K30 K31 K32 K33 K34 K35 K36 K37 K38 K39 K40 K41 K42 K43 K45 K46 K47 K48 K49 K50 K51 K52 K53 K54 K55 K58 K59 K6 K60 K61 K62 K63 K64 K65 K66 K67 K68 K69 K70 K71 K73 K74 K75 K76 K77 K78 K79 K80 K81 K82 K83 K84 K85 K86 K87 K88 K89 K90 K91 K92 K93 K94 K95 K96 K97 K98 K99 KA KAT KB KBA KCC KDW KEL KGM KGS KHY KHZ KI KIC KIP KJ KJO KL KLK KLX KMA KMH KMK KMQ KMT KNI KNM KNS KNT KO KPA KPH KPO KPP KR KSD KSH KT KTN KUR KVA KVR KVT KW KWH KWN KWO KWS KWT KWY KX L10 L11 L12 L13 L14 L15 L16 L17 L18 L19 L2 L20 L21 L23 L24 L25 L26 L27 L28 L29 L30 L31 L32 L33 L34 L35 L36 L37 L38 L39 L40 L41 L42 L43 L44 L45 L46 L47 L48 L49 L50 L51 L52 L53 L54 L55 L56 L57 L58 L59 L60 L63 L64 L65 L66 L67 L68 L69 L70 L71 L72 L73 L74 L75 L76 L77 L78 L79 L80 L81 L82 L83 L84 L85 L86 L87 L88 L89 L90 L91 L92 L93 L94 L95 L96 L98 L99 LA LAC LBR LBT LD LEF LF LH LK LM LN LO LP LPA LR LS LTN LTR LUB LUM LUX LY M1 M10 M11 M12 M13 M14 M15 M16 M17 M18 M19 M20 M21 M22 M23 M24 M25 M26 M27 M29 M30 M31 M32 M33 M34 M35 M36 M37 M38 M39 M4 M40 M41 M42 M43 M44 M45 M46 M47 M48 M49 M5 M50 M51 M52 M53 M55 M56 M57 M58 M59 M60 M61 M62 M63 M64 M65 M66 M67 M68 M69 M7 M70 M71 M72 M73 M74 M75 M76 M77 M78 M79 M80 M81 M82 M83 M84 M85 M86 M87 M88 M89 M9 M90 M91 M92 M93 M94 M95 M96 M97 M98 M99 MAH MAL MAM MAR MAW MBE MBF MBR MC MCU MD MGM MHZ MIK MIL MIN MIO MIU MKD MKM MKW MLD MLT MMK MMQ MMT MND MNJ MON MPA MQD MQH MQM MQS MQW MRD MRM MRW MSK MTK MTQ MTR MTS MTZ MVA MWH N1 N10 N11 N12 N13 N14 N15 N16 N17 N18 N19 N20 N21 N22 N23 N24 N25 N26 N27 N28 N29 N3 N30 N31 N32 N33 N34 N35 N36 N37 N38 N39 N40 N41 N42 N43 N44 N45 N46 N47 N48 N49 N50 N51 N52 N53 N54 N55 N56 N57 N58 N59 N60 N61 N62 N63 N64 N65 N66 N67 N68 N69 N70 N71 N72 N73 N74 N75 N76 N77 N78 N79 N80 N81 N82 N83 N84 N85 N86 N87 N88 N89 N90 N91 N92 N93 N94 N95 N96 N97 N98 N99 NA NAR NCL NEW NF NIL NIU NL NM3 NMI NMP NPT NT NTU NU NX OA ODE ODG ODK ODM OHM ON ONZ OPM OT OZA OZI P1 P10 P11 P12 P13 P14 P15 P16 P17 P18 P19 P2 P20 P21 P22 P23 P24 P25 P26 P27 P28 P29 P30 P31 P32 P33 P34 P35 P36 P37 P38 P39 P40 P41 P42 P43 P44 P45 P46 P47 P48 P49 P5 P50 P51 P52 P53 P54 P55 P56 P57 P58 P59 P60 P61 P62 P63 P64 P65 P66 P67 P68 P69 P70 P71 P72 P73 P74 P75 P76 P77 P78 P79 P80 P81 P82 P83 P84 P85 P86 P87 P88 P89 P90 P91 P92 P93 P94 P95 P96 P97 P98 P99 PAL PD PFL PGL PI PLA PO PQ PR PS PTD PTI PTL PTN Q10 Q11 Q12 Q13 Q14 Q15 Q16 Q17 Q18 Q19 Q20 Q21 Q22 Q23 Q24 Q25 Q26 Q27 Q28 Q29 Q3 Q30 Q31 Q32 Q33 Q34 Q35 Q36 Q37 Q38 Q39 Q40 Q41 Q42 QA QAN QB QR QTD QTI QTL QTR R1 R9 RH RM ROM RP RPM RPS RT S3 S4 SAN SCO SCR SEC SET SG SIE SM3 SMI SQ SQR SR STC STI STK STL STN STW SW SX SYR T0 T3 TAH TAN TI TIC TIP TKM TMS TNE TP TPI TPR TQD TRL TST TTS U1 U2 UB UC VA VLT VP W2 WA WB WCD WE WEB WEE WG WHR WM WSD WTT X1 YDK YDQ YRD Z11 Z9 ZP ZZ X1A X1B X1D X1F X1G X1W X2C X3A X3H X43 X44 X4A X4B X4C X4D X4F X4G X4H X5H X5L X5M X6H X6P X7A X7B X8A X8B X8C XAA XAB XAC XAD XAE XAF XAG XAH XAI XAJ XAL XAM XAP XAT XAV XB4 XBA XBB XBC XBD XBE XBF XBG XBH XBI XBJ XBK XBL XBM XBN XBO XBP XBQ XBR XBS XBT XBU XBV XBW XBX XBY XBZ XCA XCB XCC XCD XCE XCF XCG XCH XCI XCJ XCK XCL XCM XCN XCO XCP XCQ XCR XCS XCT XCU XCV XCW XCX XCY XCZ XDA XDB XDC XDG XDH XDI XDJ XDK XDL XDM XDN XDP XDR XDS XDT XDU XDV XDW XDX XDY XEC XED XEE XEF XEG XEH XEI XEN XFB XFC XFD XFE XFI XFL XFO XFP XFR XFT XFW XFX XGB XGI XGL XGR XGU XGY XGZ XHA XHB XHC XHG XHN XHR XIA XIB XIC XID XIE XIF XIG XIH XIK XIL XIN XIZ XJB XJC XJG XJR XJT XJY XKG XKI XLE XLG XLT XLU XLV XLZ XMA XMB XMC XME XMR XMS XMT XMW XMX XNA XNE XNF XNG XNS XNT XNU XNV XO1 XO2 XO3 XO4 XO5 XO6 XO7 XO8 XO9 XOA XOB XOC XOD XOE XOF XOG XOH XOI XOJ XOK XOL XOM XON XOP XOQ XOR XOS XOT XOU XOV XOW XOX XOY XOZ XP1 XP2 XP3 XP4 XPA XPB XPC XPD XPE XPF XPG XPH XPI XPJ XPK XPL XPN XPO XPP XPR XPT XPU XPV XPX XPY XPZ XQA XQB XQC XQD XQF XQG XQH XQJ XQK XQL XQM XQN XQP XQQ XQR XQS XRD XRG XRJ XRK XRL XRO XRT XRZ XSA XSB XSC XSD XSE XSH XSI XSK XSL XSM XSO XSP XSS XST XSU XSV XSW XSX XSY XSZ XT1 XTB XTC XTD XTE XTG XTI XTK XTL XTN XTO XTR XTS XTT XTU XTV XTW XTY XTZ XUC XUN XVA XVG XVI XVK XVL XVN XVO XVP XVQ XVR XVS XVY XWA XWB XWC XWD XWF XWG XWH XWJ XWK XWL XWM XWN XWP XWQ XWR XWS XWT XWU XWV XWW XWX XWY XWZ XXA XXB XXC XXD XXF XXG XXH XXJ XXK XYA XYB XYC XYD XYF XYG XYH XYJ XYK XYL XYM XYN XYP XYQ XYR XYS XYT XYV XYW XYX XYY XYZ XZA XZB XZC XZD XZF XZG XZH XZJ XZK XZL XZM XZN XZP XZQ XZR XZS XZT XZU XZV XZW XZX XZY XZZ ', concat(' ', normalize-space(@unitCode), ' ')))))">
    <svrl:failed-assert id="BR-CL-23" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-CL-23]-Unit code MUST be coded according to the UN/ECE Recommendation 20 with Rec 21 extension</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:AttachmentBinaryObject[@mimeCode] [EN16931-Codes] -->
<xsl:template match="ram:AttachmentBinaryObject[@mimeCode]" mode="svrl" priority="208">
  <xsl:if test="not(((@mimeCode = 'application/pdf' or @mimeCode  = 'image/png' or @mimeCode  = 'image/jpeg' or @mimeCode  = 'text/csv' or @mimeCode  = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' or @mimeCode  = 'application/vnd.oasis.opendocument.spreadsheet')))">
    <svrl:failed-assert id="BR-CL-24" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-CL-24]-For Mime code in attribute use MIMEMediaType.</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:URIUniversalCommunication/ram:URIID[@schemeID] [EN16931-Codes] -->
<xsl:template match="ram:URIUniversalCommunication/ram:URIID[@schemeID]" mode="svrl" priority="209">
  <xsl:if test="not(((not(contains(normalize-space(@schemeID), ' ')) and contains(' 0002 0007 0009 0037 0060 0088 0096 0097 0106 0130 0135 0142 0147 0151 0154 0158 0170 0177 0183 0184 0188 0190 0191 0192 0193 0194 0195 0196 0198 0199 0200 0201 0202 0203 0204 0205 0208 0209 0210 0211 0212 0213 0215 0216 0217 0218 0219 0220 0221 0225 0230 0235 0240 0244 0242 0245 0246 0248 9910 9913 9914 9915 9918 9919 9920 9922 9923 9924 9925 9926 9927 9928 9929 9930 9931 9932 9933 9934 9935 9936 9937 9938 9939 9940 9941 9942 9943 9944 9945 9946 9947 9948 9949 9950 9951 9952 9953 9957 9959 AN AQ AS AU EM ', concat(' ', normalize-space(@schemeID), ' ')))))">
    <svrl:failed-assert id="BR-CL-25" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-CL-25]-Endpoint identifier scheme identifier MUST belong to the CEF EAS code list</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

<!-- Context: ram:ApplicableHeaderTradeDelivery/ram:ShipToTradeParty/ram:GlobalID[@schemeID] [EN16931-Codes] -->
<xsl:template match="ram:ApplicableHeaderTradeDelivery/ram:ShipToTradeParty/ram:GlobalID[@schemeID]" mode="svrl" priority="210">
  <xsl:if test="not(((not(contains(normalize-space(@schemeID), ' ')) and contains(' 0002 0003 0004 0005 0006 0007 0008 0009 0010 0011 0012 0013 0014 0015 0016 0017 0018 0019 0020 0021 0022 0023 0024 0025 0026 0027 0028 0029 0030 0031 0032 0033 0034 0035 0036 0037 0038 0039 0040 0041 0042 0043 0044 0045 0046 0047 0048 0049 0050 0051 0052 0053 0054 0055 0056 0057 0058 0059 0060 0061 0062 0063 0064 0065 0066 0067 0068 0069 0070 0071 0072 0073 0074 0075 0076 0077 0078 0079 0080 0081 0082 0083 0084 0085 0086 0087 0088 0089 0090 0091 0093 0094 0095 0096 0097 0098 0099 0100 0101 0102 0104 0105 0106 0107 0108 0109 0110 0111 0112 0113 0114 0115 0116 0117 0118 0119 0120 0121 0122 0123 0124 0125 0126 0127 0128 0129 0130 0131 0132 0133 0134 0135 0136 0137 0138 0139 0140 0141 0142 0143 0144 0145 0146 0147 0148 0149 0150 0151 0152 0153 0154 0155 0156 0157 0158 0159 0160 0161 0162 0163 0164 0165 0166 0167 0168 0169 0170 0171 0172 0173 0174 0175 0176 0177 0178 0179 0180 0183 0184 0185 0186 0187 0188 0189 0190 0191 0192 0193 0194 0195 0196 0197 0198 0199 0200 0201 0202 0203 0204 0205 0206 0207 0208 0209 0210 0211 0212 0213 0214 0215 0216 0217 0218 0219 0220 0221 0222 0223 0224 0225 0226 0227 0228 0229 0230 0231 0232 0233 0234 0235 0236 0237 0238 0239 0240 0241 0242 0243 0244 0245 0246 0247 0248 ', concat(' ', normalize-space(@schemeID), ' ')))))">
    <svrl:failed-assert id="BR-CL-26" flag="fatal" location="saxon:path()">
      <svrl:text>[BR-CL-26]-Delivery location identifier scheme identifier MUST belong to the ISO 6523 ICD
      code list</svrl:text>
    </svrl:failed-assert>
  </xsl:if>
  <xsl:apply-templates select="*" mode="svrl"/>
</xsl:template>

</xsl:stylesheet>