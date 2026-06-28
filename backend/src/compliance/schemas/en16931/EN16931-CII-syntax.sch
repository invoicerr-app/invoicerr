<?xml version="1.0" encoding="ISO-8859-1"?>
<!--

    Licensed under European Union Public Licence (EUPL) version 1.2.

-->
<!-- Data binding to CII syntax for TC434 -->
<pattern xmlns="http://purl.oclc.org/dsdl/schematron" is-a="EN16931-CII" id="EN16931-CII-Syntax">
	<!-- Invoice -->
	<param name="CII-SR-001" value="not(ram:SpecifiedTransactionID)"/>
	<param name="CII-SR-002" value="not(ram:TestIndicator)"/>
	<param name="CII-SR-003" value="(count(ram:BusinessProcessSpecifiedDocumentContextParameter) &lt;= 1)"/>
	<param name="CII-SR-004" value="not(ram:Value)"/>
	<param name="CII-SR-007" value="not(ram:ScenarioSpecifiedDocumentContextParameter)"/>
	<param name="CII-SR-008" value="not(ram:ApplicationSpecifiedDocumentContextParameter)"/>
	<param name="CII-SR-009" value="count(ram:GuidelineSpecifiedDocumentContextParameter) = 1"/>
	<param name="CII-SR-010"
		value="count(ram:GuidelineSpecifiedDocumentContextParameter/ram:ID) = 1"/>
	<param name="CII-SR-011" value="not(ram:SubsetSpecifiedDocumentContextParameter)"/>
	<param name="CII-SR-012" value="not(ram:MessageStandardSpecifiedDocumentContextParameter)"/>
	<param name="CII-SR-013" value="not(ram:Name)"/>
	<param name="CII-SR-014" value="count(ram:TypeCode) = 1"/>
	<param name="CII-SR-015" value="not(ram:IssueDateTime/udt:DateTime)"/>
	<param name="CII-SR-016" value="not(ram:CopyIndicator)"/>
	<param name="CII-SR-017" value="not(ram:Purpose)"/>
	<param name="CII-SR-018" value="not(ram:ControlRequirementIndicator)"/>
	<param name="CII-SR-019" value="not(ram:LanguageID)"/>
	<param name="CII-SR-020" value="not(ram:PurposeCode)"/>
	<param name="CII-SR-021" value="not(ram:RevisionDateTime)"/>
	<param name="CII-SR-022" value="not(ram:VersionID)"/>
	<param name="CII-SR-023" value="not(ram:GlobalID)"/>
	<param name="CII-SR-024" value="not(ram:RevisionID)"/>
	<param name="CII-SR-025" value="not(ram:PreviousRevisionID)"/>
	<param name="CII-SR-026" value="not(ram:CategoryCode)"/>
	<param name="CII-SR-027" value="not(ram:IncludedNote/ram:Subject)"/>
	<param name="CII-SR-028" value="not(ram:IncludedNote/ram:ContentCode)"/>
	<param name="CII-SR-030" value="count(ram:Content) &lt;= 1"/>

	<param name="CII-SR-032" value="not(ram:IncludedNote/ram:ID)"/>
	<param name="CII-SR-033" value="not(ram:EffectiveSpecifiedPeriod)"/>
	<param name="CII-SR-034" value="not(ram:IssuerTradeParty)"/>
	<!-- Document context -->
	<param name="CII-SR-005" value="not(ram:SpecifiedDocumentVersion)"/>
	<param name="CII-SR-006" value="not(ram:BIMSpecifiedDocumentContextParameter)"/>
	<!-- Invoice line -->
	<param name="CII-SR-035" value="not(ram:DescriptionCode)"/>
	<param name="CII-SR-036" value="not(ram:ParentLineID)"/>
	<param name="CII-SR-037" value="not(ram:LineStatusCode)"/>
	<param name="CII-SR-038" value="not(ram:LineStatusReasonCode)"/>
	<param name="CII-SR-039" value="count(ram:IncludedNote) &lt;= 1"/>
	<param name="CII-SR-040" value="count(ram:IncludedNote/ram:Content) &lt;= 1"/>
	<param name="CII-SR-041" value="not(ram:IncludedNote/ram:SubjectCode)"/>
	<param name="CII-SR-042" value="not(ram:IncludedNote/ram:ID)"/>
	<param name="CII-SR-043" value="not(ram:IncludedNote/ram:Subject)"/>
	<param name="CII-SR-044" value="not(ram:IncludedNote/ram:ContentCode)"/>
	<param name="CII-SR-221" value="not(ram:IncludedSubordinateTradeLineItem)"/>
	
	<!-- Product information -->
	<param name="CII-SR-045" value="not(ram:ID)"/>
	<param name="CII-SR-046" value="not(ram:GlobalID) or (ram:GlobalID/@schemeID)"/>

	<param name="CII-SR-048" value="not(ram:ManufacturerAssignedID)"/>
	<param name="CII-SR-049" value="not(ram:TradeName)"/>
	<param name="CII-SR-050" value="not(ram:TypeCode)"/>
	<param name="CII-SR-051" value="not(ram:NetWeightMeasure)"/>
	<param name="CII-SR-052" value="not(ram:GrossWeightMeasure)"/>
	<param name="CII-SR-053" value="not(ram:ProductGroupID)"/>
	<param name="CII-SR-054" value="not(ram:EndItemTypeCode)"/>
	<param name="CII-SR-055" value="not(ram:EndItemName)"/>
	<param name="CII-SR-056" value="not(ram:AreaDensityMeasure)"/>
	<param name="CII-SR-057" value="not(ram:UseDescription)"/>
	<param name="CII-SR-058" value="not(ram:BrandName)"/>
	<param name="CII-SR-059" value="not(ram:SubBrandName)"/>
	<param name="CII-SR-060" value="not(ram:DrainedNetWeightMeasure)"/>
	<param name="CII-SR-061" value="not(ram:VariableMeasureIndicator)"/>
	<param name="CII-SR-062" value="not(ram:ColourCode)"/>
	<param name="CII-SR-063" value="not(ram:ColourDescription)"/>
	<param name="CII-SR-064" value="not(ram:Designation)"/>
	<param name="CII-SR-065" value="not(ram:FormattedCancellationAnnouncedLaunchDateTime)"/>
	<param name="CII-SR-066" value="not(ram:FormattedLatestProductDataChangeDateTime)"/>
	<param name="CII-SR-067" value="not(ram:ApplicableProductCharacteristic/ram:ID)"/>
	<param name="CII-SR-068" value="not(ram:ApplicableProductCharacteristic/ram:TypeCode)"/>
	<param name="CII-SR-069" value="(count(ram:Description) =1)"/>
	<param name="CII-SR-070" value="not(ram:ApplicableProductCharacteristic/ram:ValueMeasure)"/>
	<param name="CII-SR-071"
		value="not(ram:ApplicableProductCharacteristic/ram:MeasurementMethodCode)"/>
	<param name="CII-SR-072" value="(count(ram:Value) =1)"/>
	<param name="CII-SR-073" value="not(ram:ApplicableProductCharacteristic/ram:ValueCode)"/>
	<param name="CII-SR-074" value="not(ram:ApplicableProductCharacteristic/ram:ValueDateTime)"/>
	<param name="CII-SR-075" value="not(ram:ApplicableProductCharacteristic/ram:ValueIndicator)"/>
	<param name="CII-SR-076" value="not(ram:ApplicableProductCharacteristic/ram:ContentTypeCode)"/>
	<param name="CII-SR-077"
		value="not(ram:ApplicableProductCharacteristic/ram:ValueSpecifiedBinaryFile)"/>
	<param name="CII-SR-078"
		value="not(ram:ApplicableProductCharacteristic/ram:ApplicableProductCharacteristicCondition)"/>
	<param name="CII-SR-079"
		value="not(ram:ApplicableProductCharacteristic/ram:ApplicableReferencedStandard)"/>
	<param name="CII-SR-080" value="not(ram:ApplicableMaterialGoodsCharacteristic)"/>

	<param name="CII-SR-081" value="not(ram:DesignatedProductClassification/ram:SystemID)"/>
	<param name="CII-SR-082" value="not(ram:DesignatedProductClassification/ram:SystemName)"/>
	<param name="CII-SR-083" value="not(ram:DesignatedProductClassification/ram:ClassName)"/>
	<param name="CII-SR-084" value="not(ram:DesignatedProductClassification/ram:SubClassCode)"/>
	<param name="CII-SR-085"
		value="not(ram:DesignatedProductClassification/ram:ClassProductCharacteristic)"/>
	<param name="CII-SR-086"
		value="not(ram:DesignatedProductClassification/ram:ApplicableReferencedStandard)"/>

	<param name="CII-SR-087" value="not(ram:IndividualTradeProductInstance)"/>
	<param name="CII-SR-088" value="not(ram:CertificationEvidenceReferenceReferencedDocument)"/>
	<param name="CII-SR-089" value="not(ram:InspectionReferenceReferencedDocument)"/>

	<param name="CII-SR-090"
		value="not (ram:OriginTradeCountry) or (count(ram:OriginTradeCountry/ram:ID) =1)"/>
	<param name="CII-SR-091" value="not(ram:OriginTradeCountry/ram:Name)"/>
	<param name="CII-SR-092"
		value="not(ram:OriginTradeCountry/ram:SubordinateTradeCountrySubDivision)"/>

	<param name="CII-SR-093" value="not(ram:LinearSpatialDimension)"/>
	<param name="CII-SR-094" value="not(ram:MinimumLinearSpatialDimension)"/>
	<param name="CII-SR-095" value="not(ram:MaximumLinearSpatialDimension)"/>
	<param name="CII-SR-096" value="not(ram:ManufacturerTradeParty)"/>
	<param name="CII-SR-097" value="not(ram:PresentationSpecifiedBinaryFile)"/>
	<param name="CII-SR-098" value="not(ram:MSDSReferenceReferencedDocument)"/>
	<param name="CII-SR-099" value="not(ram:AdditionalReferenceReferencedDocument)"/>
	<param name="CII-SR-100" value="not(ram:LegalRightsOwnerTradeParty)"/>
	<param name="CII-SR-101" value="not(ram:BrandOwnerTradeParty)"/>
	<param name="CII-SR-102" value="not(ram:IncludedReferencedProduct)"/>
	<param name="CII-SR-103" value="not(ram:InformationNote)"/>
	<!-- SpecifiedLineTradeAgreement -->
	<param name="CII-SR-104" value="not(ram:BuyerReference)"/>
	<param name="CII-SR-105" value="not(ram:BuyerRequisitionerTradeParty)"/>
	<param name="CII-SR-106" value="not(ram:ApplicableTradeDeliveryTerms)"/>
	<param name="CII-SR-107" value="not(ram:SellerOrderReferencedDocument)"/>
	<param name="CII-SR-108" value="not(ram:BuyerOrderReferencedDocument/ram:IssuerAssignedID)"/>
	<param name="CII-SR-109" value="not(ram:QuotationReferencedDocument)"/>
	<param name="CII-SR-110" value="not(ram:ContractReferencedDocument)"/>
	<param name="CII-SR-111" value="not(ram:DemandForecastReferencedDocument)"/>
	<param name="CII-SR-112" value="not(ram:PromotionalDealReferencedDocument)"/>
	<param name="CII-SR-113" value="not(ram:AdditionalReferencedDocument)"/>
	<param name="CII-SR-114" value="not(ram:GrossPriceProductTradePrice/ram:TypeCode)"/>
	<param name="CII-SR-115" value="not(ram:GrossPriceProductTradePrice/ram:MinimumQuantity)"/>
	<param name="CII-SR-116" value="not(ram:GrossPriceProductTradePrice/ram:MaximumQuantity)"/>
	<param name="CII-SR-117" value="not(ram:GrossPriceProductTradePrice/ram:ChangeReason)"/>
	<param name="CII-SR-118"
		value="not(ram:GrossPriceProductTradePrice/ram:OrderUnitConversionFactorNumeric)"/>
	<param name="CII-SR-439" value="count(ram:NetPriceProductTradePrice/ram:ChargeAmount) = 1"/>

	<param name="CII-SR-119"
		value="(ram:GrossPriceProductTradePrice/ram:AppliedTradeAllowanceCharge/ram:ChargeIndicator[udt:Indicator=false()] and ram:GrossPriceProductTradePrice/ram:AppliedTradeAllowanceCharge/ram:ActualAmount) or (not (ram:GrossPriceProductTradePrice/ram:AppliedTradeAllowanceCharge/ram:ChargeIndicator) and not (ram:GrossPriceProductTradePrice/ram:AppliedTradeAllowanceCharge/ram:ActualAmount))"/>
	<param name="CII-SR-120"
		value="not(ram:GrossPriceProductTradePrice/ram:AppliedTradeAllowanceCharge/ram:ID)"/>
	<param name="CII-SR-121"
		value="not(ram:GrossPriceProductTradePrice/ram:AppliedTradeAllowanceCharge/ram:SequenceNumeric)"/>
	<param name="CII-SR-122"
		value="not(ram:GrossPriceProductTradePrice/ram:AppliedTradeAllowanceCharge/ram:CalculationPercent)"/>
	<param name="CII-SR-123"
		value="not(ram:GrossPriceProductTradePrice/ram:AppliedTradeAllowanceCharge/ram:BasisAmount)"/>
	<param name="CII-SR-124"
		value="not(ram:GrossPriceProductTradePrice/ram:AppliedTradeAllowanceCharge/ram:BasisQuantity)"/>
	<param name="CII-SR-125"
		value="not(ram:GrossPriceProductTradePrice/ram:AppliedTradeAllowanceCharge/ram:PrepaidIndicator)"/>
	<param name="CII-SR-126"
		value="not(ram:GrossPriceProductTradePrice/ram:AppliedTradeAllowanceCharge/ram:UnitBasisAmount)"/>
	<param name="CII-SR-127"
		value="not(ram:GrossPriceProductTradePrice/ram:AppliedTradeAllowanceCharge/ram:ReasonCode)"/>
	<param name="CII-SR-128"
		value="not(ram:GrossPriceProductTradePrice/ram:AppliedTradeAllowanceCharge/ram:Reason)"/>
	<param name="CII-SR-129"
		value="not(ram:GrossPriceProductTradePrice/ram:AppliedTradeAllowanceCharge/ram:TypeCode)"/>
	<param name="CII-SR-130"
		value="not(ram:GrossPriceProductTradePrice/ram:AppliedTradeAllowanceCharge/ram:CategoryTradeTax)"/>
	<param name="CII-SR-131"
		value="not(ram:GrossPriceProductTradePrice/ram:AppliedTradeAllowanceCharge/ram:ActualTradeCurrencyExchange)"/>
	<param name="CII-SR-445" value="not(ram:GrossPriceProductTradePrice/ram:IncludedTradeTax)"/>
	<param name="CII-SR-132"
		value="not(ram:GrossPriceProductTradePrice/ram:ValiditySpecifiedPeriod)"/>
	<param name="CII-SR-133" value="not(ram:GrossPriceProductTradePrice/ram:DeliveryTradeLocation)"/>
	<param name="CII-SR-134"
		value="not(ram:GrossPriceProductTradePrice/ram:TradeComparisonReferencePrice)"/>
	<param name="CII-SR-135"
		value="not(ram:GrossPriceProductTradePrice/ram:AssociatedReferencedDocument)"/>

	<param name="CII-SR-136" value="not(ram:NetPriceProductTradePrice/ram:TypeCode)"/>

	<param name="CII-SR-138" value="not(ram:NetPriceProductTradePrice/ram:MinimumQuantity)"/>
	<param name="CII-SR-139" value="not(ram:NetPriceProductTradePrice/ram:MaximumQuantity)"/>
	<param name="CII-SR-140" value="not(ram:NetPriceProductTradePrice/ram:ChangeReason)"/>
	<param name="CII-SR-141"
		value="not(ram:NetPriceProductTradePrice/ram:OrderUnitConversionFactorNumeric)"/>
	<param name="CII-SR-142"
		value="not(ram:NetPriceProductTradePrice/ram:AppliedTradeAllowanceCharge)"/>
	<param name="CII-SR-446" value="not(ram:NetPriceProductTradePrice/ram:IncludedTradeTax)"/>
	<param name="CII-SR-143" value="not(ram:NetPriceProductTradePrice/ram:ValiditySpecifiedPeriod)"/>
	<param name="CII-SR-144" value="not(ram:NetPriceProductTradePrice/ram:DeliveryTradeLocation)"/>
	<param name="CII-SR-145"
		value="not(ram:NetPriceProductTradePrice/ram:TradeComparisonReferencePrice)"/>
	<param name="CII-SR-146"
		value="not(ram:NetPriceProductTradePrice/ram:AssociatedReferencedDocument)"/>
	<param name="CII-SR-441" value="count(ram:NetPriceProductTradePrice/ram:ChargeAmount) &lt;= 1"/>

	<param name="CII-SR-147" value="not(ram:RequisitionerReferencedDocument)"/>
	<param name="CII-SR-148" value="not(ram:ItemSellerTradeParty)"/>
	<param name="CII-SR-149" value="not(ram:ItemBuyerTradeParty)"/>
	<param name="CII-SR-150" value="not(ram:IncludedSpecifiedMarketplace)"/>
	<param name="CII-SR-447" value="not(ram:UltimateCustomerOrderReferencedDocument)"/>
	<param name="CII-SR-464" value="not(ram:PayerSpecifiedDebtorFinancialInstitution)"/>

	<!-- AppliedTradeAllowanceCharge -->
	<param name="CII-SR-440"
		value="count(ram:ActualAmount) &lt;= 1"/>

	
	<!-- SpecifiedTradeAllowanceCharge -->
	
	<param name="CII-SR-471" value="count(ram:RateApplicablePercent) &lt;= 1"/>
	<param name="CII-SR-472" value="count(ram:CategoryTradeTax) &lt;= 1"/>
	<param name="CII-SR-473" value="count(ram:ActualAmount) &lt;= 1"/>
	
	<!-- SpecifiedLineTradeDelivery -->
	<param name="CII-SR-151" value="not(ram:RequestedQuantity)"/>
	<param name="CII-SR-152" value="not(ram:ReceivedQuantity)"/>
	<param name="CII-SR-153" value="not(ram:ChargeFreeQuantity)"/>
	<param name="CII-SR-154" value="not(ram:PackageQuantity)"/>
	<param name="CII-SR-155" value="not(ram:ProductUnitQuantity)"/>
	<param name="CII-SR-156" value="not(ram:PerPackageUnitQuantity)"/>
	<param name="CII-SR-157" value="not(ram:NetWeightMeasure)"/>
	<param name="CII-SR-158" value="not(ram:GrossWeightMeasure)"/>
	<param name="CII-SR-159" value="not(ram:TheoreticalWeightMeasure)"/>
	<param name="CII-SR-160" value="not(ram:DespatchedQuantity)"/>
	<param name="CII-SR-161" value="not(ram:SpecifiedDeliveryAdjustment)"/>
	<param name="CII-SR-162" value="not(ram:IncludedSupplyChainPackaging)"/>
	<param name="CII-SR-163" value="not(ram:RelatedSupplyChainConsignment)"/>
	<param name="CII-SR-164" value="not(ram:ShipToTradeParty)"/>
	<param name="CII-SR-165" value="not(ram:UltimateShipToTradeParty)"/>
	<param name="CII-SR-166" value="not(ram:ShipFromTradeParty)"/>
	<param name="CII-SR-167" value="not(ram:ActualDespatchSupplyChainEvent)"/>
	<param name="CII-SR-168" value="not(ram:ActualPickUpSupplyChainEvent)"/>
	<param name="CII-SR-169" value="not(ram:RequestedDeliverySupplyChainEvent)"/>
	<param name="CII-SR-170" value="not(ram:ActualDeliverySupplyChainEvent)"/>
	<param name="CII-SR-171" value="not(ram:ActualReceiptSupplyChainEvent)"/>
	<param name="CII-SR-172" value="not(ram:AdditionalReferencedDocument)"/>
	<param name="CII-SR-173" value="not(ram:DespatchAdviceReferencedDocument)"/>
	<param name="CII-SR-174" value="not(ram:ReceivingAdviceReferencedDocument)"/>
	<param name="CII-SR-175" value="not(ram:DeliveryNoteReferencedDocument)"/>
	<param name="CII-SR-176" value="not(ram:ConsumptionReportReferencedDocument)"/>
	<param name="CII-SR-177" value="not(ram:PackingListReferencedDocument)"/>

	<!-- SpecifiedLineTradeSettlement -->
	<param name="CII-SR-178" value="not(ram:PaymentReference)"/>
	<param name="CII-SR-179" value="not(ram:InvoiceIssuerReference)"/>
	<param name="CII-SR-180" value="not(ram:TotalAdjustmentAmount)"/>
	<param name="CII-SR-181" value="not(ram:DiscountIndicator)"/>
	<param name="CII-SR-182" value="not(ram:ApplicableTradeTax/ram:CalculatedAmount)"/>
	<param name="CII-SR-183"
		value="not(ram:SpecifiedTradeAllowanceCharge/ram:ChargeIndicator/udt:IndicatorString)"/>
	<param name="CII-SR-184" value="not(ram:SpecifiedTradeAllowanceCharge/ram:ID)"/>
	<param name="CII-SR-185" value="not(ram:SpecifiedTradeAllowanceCharge/ram:SequenceNumeric)"/>
	<param name="CII-SR-186"
		value="not(ram:SpecifiedTradeAllowanceCharge/ram:CalculationPercent/@format)"/>
	<param name="CII-SR-187" value="not(ram:SpecifiedTradeAllowanceCharge/ram:BasisQuantity)"/>
	<param name="CII-SR-188" value="not(ram:SpecifiedTradeAllowanceCharge/ram:PrepaidIndicator)"/>
	<param name="CII-SR-189" value="not(ram:SpecifiedTradeAllowanceCharge/ram:UnitBasisAmount)"/>
	<param name="CII-SR-190" value="not(ram:SpecifiedTradeAllowanceCharge/ram:TypeCode)"/>
	<param name="CII-SR-191" value="not(ram:SpecifiedTradeAllowanceCharge/ram:CategoryTradeTax)"/>
	<param name="CII-SR-192"
		value="not(ram:SpecifiedTradeAllowanceCharge/ram:ActualTradeCurrencyExchange)"/>
	<param name="CII-SR-193" value="not(ram:SpecifiedTradeAllowanceCharge/ram:ID)"/>

	<param name="CII-SR-194" value="not(ram:SubtotalCalculatedTradeTax)"/>
	<param name="CII-SR-195" value="not(ram:SpecifiedLogisticsServiceCharge)"/>
	<param name="CII-SR-196" value="not(ram:SpecifiedTradePaymentTerms)"/>
	<param name="CII-SR-197"
		value="not(ram:SpecifiedTradeSettlementLineMonetarySummation/ram:ChargeTotalAmount)"/>
	<param name="CII-SR-198"
		value="not(ram:SpecifiedTradeSettlementLineMonetarySummation/ram:AllowanceTotalAmount)"/>
	<param name="CII-SR-199"
		value="not(ram:SpecifiedTradeSettlementLineMonetarySummation/ram:TaxBasisTotalAmount)"/>
	<param name="CII-SR-200"
		value="not(ram:SpecifiedTradeSettlementLineMonetarySummation/ram:TaxTotalAmount)"/>
	<param name="CII-SR-201"
		value="not(ram:SpecifiedTradeSettlementLineMonetarySummation/ram:GrandTotalAmount)"/>
	<param name="CII-SR-202"
		value="not(ram:SpecifiedTradeSettlementLineMonetarySummation/ram:InformationAmount)"/>
	<param name="CII-SR-203"
		value="not(ram:SpecifiedTradeSettlementLineMonetarySummation/ram:TotalAllowanceChargeAmount)"/>
	<param name="CII-SR-204"
		value="not(ram:SpecifiedTradeSettlementLineMonetarySummation/ram:TotalRetailValueInformationAmount)"/>
	<param name="CII-SR-205"
		value="not(ram:SpecifiedTradeSettlementLineMonetarySummation/ram:GrossLineTotalAmount)"/>
	<param name="CII-SR-206"
		value="not(ram:SpecifiedTradeSettlementLineMonetarySummation/ram:NetLineTotalAmount)"/>
	<param name="CII-SR-207"
		value="not(ram:SpecifiedTradeSettlementLineMonetarySummation/ram:NetIncludingTaxesLineTotalAmount)"/>
	<param name="CII-SR-208"
		value="not(ram:SpecifiedTradeSettlementLineMonetarySummation/ram:ProductWeightLossInformationAmount)"/>

	<param name="CII-SR-209" value="not(ram:SpecifiedFinancialAdjustment)"/>
	<param name="CII-SR-210" value="not(ram:InvoiceReferencedDocument)"/>

	<param name="CII-SR-212" value="not(ram:PayableSpecifiedTradeAccountingAccount)"/>
	<param name="CII-SR-213"
		value="not(ram:ReceivableSpecifiedTradeAccountingAccount/ram:SetTriggerCode)"/>
	<param name="CII-SR-214" value="not(ram:ReceivableSpecifiedTradeAccountingAccount/ram:TypeCode)"/>
	<param name="CII-SR-215"
		value="not(ram:ReceivableSpecifiedTradeAccountingAccount/ram:AmountTypeCode)"/>
	<param name="CII-SR-216" value="not(ram:ReceivableSpecifiedTradeAccountingAccount/ram:Name)"/>
	<param name="CII-SR-217"
		value="not(ram:ReceivableSpecifiedTradeAccountingAccount/ram:CostReferenceDimensionPattern)"/>
	<param name="CII-SR-218" value="not(ram:PurchaseSpecifiedTradeAccountingAccount)"/>
	<param name="CII-SR-219" value="not(ram:SalesSpecifiedTradeAccountingAccount)"/>
	<param name="CII-SR-220" value="not(ram:SpecifiedTradeSettlementFinancialCard)"/>
	<param name="CII-SR-454" value="count(ram:ApplicableTradeTax) = 1"/>
	<param name="CII-SR-474" value="count(ram:AdditionalReferencedDocument[normalize-space(ram:TypeCode) = '130']) &lt;= 1"/>
	
	
	<!-- ApplicableHeaderTradeAgreement -->
	<param name="CII-SR-442" value="not(ram:Reference)"/>
	<param name="CII-SR-222" value="not(ram:SellerTradeParty/ram:RoleCode)"/>
	<param name="CII-SR-223"
		value="not(ram:SellerTradeParty/ram:SpecifiedLegalOrganization/ram:LegalClassificationCode)"/>
	<param name="CII-SR-224"
		value="not(ram:SellerTradeParty/ram:SpecifiedLegalOrganization/ram:Name)"/>
	<param name="CII-SR-225"
		value="not(ram:SellerTradeParty/ram:SpecifiedLegalOrganization/ram:PostalTradeAddress)"/>
	<param name="CII-SR-226"
		value="not(ram:SellerTradeParty/ram:SpecifiedLegalOrganization/ram:AuthorizedLegalRegistration)"/>
	<param name="CII-SR-227" value="not(ram:SellerTradeParty/ram:DefinedTradeContact/ram:ID)"/>
	<param name="CII-SR-228" value="not(ram:SellerTradeParty/ram:DefinedTradeContact/ram:TypeCode)"/>
	<param name="CII-SR-229" value="not(ram:SellerTradeParty/ram:DefinedTradeContact/ram:JobTitle)"/>
	<param name="CII-SR-230"
		value="not(ram:SellerTradeParty/ram:DefinedTradeContact/ram:Responsibility)"/>
	<param name="CII-SR-231" value="not(ram:SellerTradeParty/ram:DefinedTradeContact/ram:PersonID)"/>
	
	
	

	<param name="CII-SR-232"
		value="not(ram:SellerTradeParty/ram:DefinedTradeContact/ram:TelephoneUniversalCommunication/ram:URIID)"/>
	<param name="CII-SR-233"
		value="not(ram:SellerTradeParty/ram:DefinedTradeContact/ram:TelephoneUniversalCommunication/ram:ChannelCode)"/>
	<param name="CII-SR-234"
		value="not(ram:SellerTradeParty/ram:DefinedTradeContact/ram:DirectTelephoneUniversalCommunication)"/>
	<param name="CII-SR-235"
		value="not(ram:SellerTradeParty/ram:DefinedTradeContact/ram:MobileTelephoneUniversalCommunication)"/>
	<param name="CII-SR-236"
		value="not(ram:SellerTradeParty/ram:DefinedTradeContact/ram:FaxUniversalCommunication)"/>
	<param name="CII-SR-237"
		value="not(ram:SellerTradeParty/ram:DefinedTradeContact/ram:EmailURIUniversalCommunication/ram:ChannelCode)"/>
	<param name="CII-SR-238"
		value="not(ram:SellerTradeParty/ram:DefinedTradeContact/ram:EmailURIUniversalCommunication/ram:CompleteNumber)"/>
	<param name="CII-SR-239"
		value="not(ram:SellerTradeParty/ram:DefinedTradeContact/ram:TelexUniversalCommunication)"/>
	<param name="CII-SR-240"
		value="not(ram:SellerTradeParty/ram:DefinedTradeContact/ram:VOIPUniversalCommunication)"/>
	<param name="CII-SR-241"
		value="not(ram:SellerTradeParty/ram:DefinedTradeContact/ram:InstantMessagingUniversalCommunication)"/>
	<param name="CII-SR-242"
		value="not(ram:SellerTradeParty/ram:DefinedTradeContact/ram:SpecifiedNote)"/>
	<param name="CII-SR-243"
		value="not(ram:SellerTradeParty/ram:DefinedTradeContact/ram:SpecifiedContactPerson)"/>

	<param name="CII-SR-244"
		value="not(ram:SellerTradeParty/ram:URIUniversalCommunication/ram:ChannelCode)"/>
	<param name="CII-SR-245"
		value="not(ram:SellerTradeParty/ram:URIUniversalCommunication/ram:CompleteNumber)"/>
	<param name="CII-SR-246"
		value="not(ram:SellerTradeParty/ram:SpecifiedTaxRegistration/ram:AssociatedRegisteredTax)"/>
	<param name="CII-SR-247" value="not(ram:SellerTradeParty/ram:EndPointURIUniversalCommunication)"/>
	<param name="CII-SR-248" value="not(ram:SellerTradeParty/ram:LogoAssociatedSpecifiedBinaryFile)"/>

	<param name="CII-SR-249" value="not(ram:BuyerTradeParty/ram:RoleCode)"/>
	<param name="CII-SR-250" value="not(ram:BuyerTradeParty/ram:Description)"/>
	<param name="CII-SR-251"
		value="not(ram:BuyerTradeParty/ram:SpecifiedLegalOrganization/ram:LegalClassificationCode)"/>
	<param name="CII-SR-252"
		value="not(ram:BuyerTradeParty/ram:SpecifiedLegalOrganization/ram:Name)"/>

	<param name="CII-SR-254"
		value="not(ram:BuyerTradeParty/ram:SpecifiedLegalOrganization/ram:PostalTradeAddress)"/>
	<param name="CII-SR-255"
		value="not(ram:BuyerTradeParty/ram:SpecifiedLegalOrganization/ram:AuthorizedLegalRegistration)"/>
	<param name="CII-SR-256" value="not(ram:BuyerTradeParty/ram:DefinedTradeContact/ram:ID)"/>
	<param name="CII-SR-257" value="not(ram:BuyerTradeParty/ram:DefinedTradeContact/ram:TypeCode)"/>
	<param name="CII-SR-258" value="not(ram:BuyerTradeParty/ram:DefinedTradeContact/ram:JobTitle)"/>
	<param name="CII-SR-259"
		value="not(ram:BuyerTradeParty/ram:DefinedTradeContact/ram:Responsibility)"/>
	<param name="CII-SR-260" value="not(ram:BuyerTradeParty/ram:DefinedTradeContact/ram:PersonID)"/>
	<param name="CII-SR-261"
		value="not(ram:BuyerTradeParty/ram:DefinedTradeContact/ram:TelephoneUniversalCommunication/ram:URIID)"/>
	<param name="CII-SR-262"
		value="not(ram:BuyerTradeParty/ram:DefinedTradeContact/ram:TelephoneUniversalCommunication/ram:ChannelCode)"/>
	<param name="CII-SR-263"
		value="not(ram:BuyerTradeParty/ram:DefinedTradeContact/ram:DirectTelephoneUniversalCommunication)"/>
	<param name="CII-SR-264"
		value="not(ram:BuyerTradeParty/ram:DefinedTradeContact/ram:MobileTelephoneUniversalCommunication)"/>
	<param name="CII-SR-265"
		value="not(ram:BuyerTradeParty/ram:DefinedTradeContact/ram:FaxUniversalCommunication)"/>
	<param name="CII-SR-266"
		value="not(ram:BuyerTradeParty/ram:DefinedTradeContact/ram:EmailURIUniversalCommunication/ram:ChannelCode)"/>
	<param name="CII-SR-267"
		value="not(ram:BuyerTradeParty/ram:DefinedTradeContact/ram:EmailURIUniversalCommunication/ram:CompleteNumber)"/>
	<param name="CII-SR-268"
		value="not(ram:BuyerTradeParty/ram:DefinedTradeContact/ram:TelexUniversalCommunication)"/>
	<param name="CII-SR-269"
		value="not(ram:BuyerTradeParty/ram:DefinedTradeContact/ram:VOIPUniversalCommunication)"/>
	<param name="CII-SR-270"
		value="not(ram:BuyerTradeParty/ram:DefinedTradeContact/ram:InstantMessagingUniversalCommunication)"/>
	<param name="CII-SR-271"
		value="not(ram:BuyerTradeParty/ram:DefinedTradeContact/ram:SpecifiedNote)"/>
	<param name="CII-SR-272"
		value="not(ram:BuyerTradeParty/ram:DefinedTradeContact/ram:SpecifiedContactPerson)"/>

	<param name="CII-SR-273"
		value="not(ram:BuyerTradeParty/ram:URIUniversalCommunication/ram:ChannelCode)"/>
	<param name="CII-SR-274"
		value="not(ram:BuyerTradeParty/ram:URIUniversalCommunication/ram:CompleteNumber)"/>
	<param name="CII-SR-275"
		value="not(ram:BuyerTradeParty/ram:SpecifiedTaxRegistration/ram:AssociatedRegisteredTax)"/>
	<param name="CII-SR-276" value="not(ram:BuyerTradeParty/ram:EndPointURIUniversalCommunication)"/>
	<param name="CII-SR-277" value="not(ram:BuyerTradeParty/ram:LogoAssociatedSpecifiedBinaryFile)"/>

	<param name="CII-SR-278" value="not(ram:SalesAgentTradeParty)"/>
	<param name="CII-SR-279" value="not(ram:BuyerRequisitionerTradeParty)"/>
	<param name="CII-SR-280" value="not(ram:BuyerAssignedAccountantTradeParty)"/>
	<param name="CII-SR-281" value="not(ram:SellerAssignedAccountantTradeParty)"/>
	<param name="CII-SR-282" value="not(ram:BuyerTaxRepresentativeTradeParty)"/>

	<param name="CII-SR-282" value="not(ram:SellerTaxRepresentativeTradeParty/ram:ID)"/>
	<param name="CII-SR-283" value="not(ram:SellerTaxRepresentativeTradeParty/ram:GlobalID)"/>
	<param name="CII-SR-284" value="not(ram:SellerTaxRepresentativeTradeParty/ram:RoleCode)"/>
	<param name="CII-SR-285" value="not(ram:SellerTaxRepresentativeTradeParty/ram:Description)"/>
	<param name="CII-SR-286"
		value="not(ram:SellerTaxRepresentativeTradeParty/ram:SpecifiedLegalOrganization)"/>
	<param name="CII-SR-287"
		value="not(ram:SellerTaxRepresentativeTradeParty/ram:DefinedTradeContact)"/>

	<param name="CII-SR-288"
		value="not(ram:SellerTaxRepresentativeTradeParty/ram:URIUniversalCommunication)"/>
	<param name="CII-SR-289"
		value="not(ram:SellerTaxRepresentativeTradeParty/ram:SpecifiedTaxRegistration/ram:AssociatedRegisteredTax)"/>
	<param name="CII-SR-290"
		value="not(ram:SellerTaxRepresentativeTradeParty/ram:EndPointURIUniversalCommunication)"/>
	<param name="CII-SR-291"
		value="not(ram:SellerTaxRepresentativeTradeParty/ram:LogoAssociatedSpecifiedBinaryFile)"/>

	<param name="CII-SR-292" value="not(ram:ProductEndUserTradeParty)"/>
	<param name="CII-SR-293" value="not(ram:ApplicableTradeDeliveryTerms)"/>
	<param name="CII-SR-294" value="not(ram:SellerOrderReferencedDocument/ram:LineID)"/>
	<param name="CII-SR-295" value="not(ram:BuyerOrderReferencedDocument/ram:LineID)"/>
	<param name="CII-SR-296" value="not(ram:QuotationReferencedDocument)"/>
	<param name="CII-SR-297" value="not(ram:OrderResponseReferencedDocument)"/>
	<param name="CII-SR-298" value="not(ram:ContractReferencedDocument/ram:LineID)"/>
	<param name="CII-SR-299" value="not(ram:DemandForecastReferencedDocument)"/>
	<param name="CII-SR-300" value="not(ram:SupplyInstructionReferencedDocument)"/>
	<param name="CII-SR-301" value="not(ram:PromotionalDealReferencedDocument)"/>
	<param name="CII-SR-302" value="not(ram:PriceListReferencedDocument)"/>
	<param name="CII-SR-303" value="not(ram:AdditionalReferencedDocument/ram:LineID)"/>
	<param name="CII-SR-304" value="not(ram:RequisitionerReferencedDocument)"/>
	<param name="CII-SR-305" value="not(ram:BuyerAgentTradeParty)"/>
	<param name="CII-SR-306" value="not(ram:PurchaseConditionsReferencedDocument)"/>
	<param name="CII-SR-307" value="not(ram:SpecifiedProcuringProject/ram:Description)"/>
	<param name="CII-SR-448" value="not(ram:UltimateCustomerOrderReferencedDocument)"/>
	<param name="CII-SR-450" value="(not(ram:BuyerTradeParty/ram:ID) and ram:BuyerTradeParty/ram:GlobalID) or (ram:BuyerTradeParty/ram:ID and not(ram:BuyerTradeParty/ram:GlobalID)) or (not(ram:BuyerTradeParty/ram:ID) and not(ram:BuyerTradeParty/ram:GlobalID))"/>
	<param name="CII-SR-455" value="( count(ram:SellerTradeParty/ram:DefinedTradeContact)  &lt;= 1)"/>
	<param name="CII-SR-456" value="( count(ram:BuyerTradeParty/ram:DefinedTradeContact)  &lt;= 1)"/>
	<param name="CII-SR-457" value="( count(ram:AdditionalReferencedDocument[ram:TypeCode='50'])  &lt;= 1)"/>
	<param name="CII-SR-458" value="( count(ram:AdditionalReferencedDocument[ram:TypeCode='130'])  &lt;= 1)"/>
	<param name="CII-SR-470" value="count(ram:SpecifiedTradeSettlementPaymentMeans[(normalize-space(ram:TypeCode) = '30' or normalize-space(ram:TypeCode) = '58') and not(ram:PayeePartyCreditorFinancialAccount/ram:IBANID or ram:PayeePartyCreditorFinancialAccount/ram:ProprietaryID)]) = 0"/>
	<param name="CII-SR-475" value="count(ram:AdditionalReferencedDocument[normalize-space(ram:TypeCode) = '916']/ram:Name) &lt;= 1"/>
	<param name="CII-SR-476" value="count(ram:AdditionalReferencedDocument[normalize-space(ram:TypeCode) = '916']/ram:AttachmentBinaryObject) &lt;= 1"/>
	
	<!-- ApplicableHeaderTradeDelivery -->
	<param name="CII-SR-308" value="not(ram:RelatedSupplyChainConsignment)"/>
	<param name="CII-SR-309" value="not(ram:ShipToTradeParty/ram:RoleCode)"/>
	<param name="CII-SR-310" value="not(ram:ShipToTradeParty/ram:Description)"/>
	<param name="CII-SR-311" value="not(ram:ShipToTradeParty/ram:SpecifiedLegalOrganization)"/>
	<param name="CII-SR-312" value="not(ram:ShipToTradeParty/ram:DefinedTradeContact)"/>
	<param name="CII-SR-313" value="not(ram:ShipToTradeParty/ram:URIUniversalCommunication)"/>
	<param name="CII-SR-314" value="not(ram:ShipToTradeParty/ram:SpecifiedTaxRegistration)"/>
	<param name="CII-SR-315" value="not(ram:ShipToTradeParty/ram:EndPointURIUniversalCommunication)"/>
	<param name="CII-SR-316" value="not(ram:ShipToTradeParty/ram:LogoAssociatedSpecifiedBinaryFile)"/>

	<param name="CII-SR-317" value="not(ram:UltimateShipToTradeParty)"/>
	<param name="CII-SR-318" value="not(ram:ShipFromTradeParty)"/>
	<param name="CII-SR-319" value="not(ram:ActualDespatchSupplyChainEvent)"/>
	<param name="CII-SR-320" value="not(ram:ActualPickUpSupplyChainEvent)"/>

	<param name="CII-SR-321" value="not(ram:ActualDeliverySupplyChainEvent/ram:ID)"/>
	<param name="CII-SR-322"
		value="not(ram:ActualDeliverySupplyChainEvent/ram:OccurrenceDateTime/udt:DateTime)"/>
	<param name="CII-SR-323" value="not(ram:ActualDeliverySupplyChainEvent/ram:TypeCode)"/>
	<param name="CII-SR-324" value="not(ram:ActualDeliverySupplyChainEvent/ram:Description)"/>
	<param name="CII-SR-325"
		value="not(ram:ActualDeliverySupplyChainEvent/ram:DescriptionBinaryObject)"/>
	<param name="CII-SR-326" value="not(ram:ActualDeliverySupplyChainEvent/ram:UnitQuantity)"/>
	<param name="CII-SR-327"
		value="not(ram:ActualDeliverySupplyChainEvent/ram:LatestOccurrenceDateTime)"/>
	<param name="CII-SR-328"
		value="not(ram:ActualDeliverySupplyChainEvent/ram:EarliestOccurrenceDateTime)"/>
	<param name="CII-SR-329"
		value="not(ram:ActualDeliverySupplyChainEvent/ram:OccurrenceSpecifiedPeriod)"/>
	<param name="CII-SR-330"
		value="not(ram:ActualDeliverySupplyChainEvent/ram:OccurrenceLogisticsLocation)"/>
	<param name="CII-SR-331" value="not(ram:ActualReceiptSupplyChainEvent)"/>
	<param name="CII-SR-332" value="not(ram:AdditionalReferencedDocument)"/>
	<param name="CII-SR-333" value="not(ram:DespatchAdviceReferencedDocument/ram:LineID)"/>
	<param name="CII-SR-334" value="not(ram:DespatchAdviceReferencedDocument/ram:LineID)"/>
	<param name="CII-SR-335" value="not(ram:DeliveryNoteReferencedDocument)"/>
	<param name="CII-SR-336" value="not(ram:ConsumptionReportReferencedDocument)"/>
	<param name="CII-SR-337" value="not(ram:PreviousDeliverySupplyChainEvent)"/>
	<param name="CII-SR-338" value="not(ram:PackingListReferencedDocument)"/>
	<param name="CII-SR-449"
		value="(not(ram:ShipToTradeParty/ram:ID) and ram:ShipToTradeParty/ram:GlobalID) or (ram:ShipToTradeParty/ram:ID and not(ram:ShipToTradeParty/ram:GlobalID)) or (not(ram:ShipToTradeParty/ram:ID) and not(ram:ShipToTradeParty/ram:GlobalID))"/>

	<!--  ApplicableHeaderTradeSettlement -->
	<param name="CII-SR-339" value="not(ram:DuePayableAmount)"/>
	<param name="CII-SR-340" value="not(ram:CreditorReferenceTypeCode)"/>
	<param name="CII-SR-341" value="not(ram:CreditorReferenceType)"/>
	<param name="CII-SR-342" value="not(ram:CreditorReferenceIssuerID)"/>

	<param name="CII-SR-344" value="not(ram:PaymentCurrencyCode)"/>
	<param name="CII-SR-345" value="not(ram:InvoiceIssuerReference)"/>
	<param name="CII-SR-346" value="not(ram:InvoiceDateTime)"/>
	<param name="CII-SR-347" value="not(ram:NextInvoiceDateTime)"/>
	<param name="CII-SR-348" value="not(ram:CreditReasonCode)"/>
	<param name="CII-SR-349" value="not(ram:CreditReason)"/>
	<param name="CII-SR-350" value="not(ram:InvoicerTradeParty)"/>
	<param name="CII-SR-351" value="not(ram:InvoiceeTradeParty)"/>

	<param name="CII-SR-352" value="not(ram:PayeeTradeParty/ram:RoleCode)"/>
	<param name="CII-SR-353" value="not(ram:PayeeTradeParty/ram:Description)"/>
	<param name="CII-SR-354"
		value="not(ram:PayeeTradeParty/ram:SpecifiedLegalOrganization/ram:LegalClassificationCode)"/>
	<param name="CII-SR-355"
		value="not(ram:PayeeTradeParty/ram:SpecifiedLegalOrganization/ram:Name)"/>
	<param name="CII-SR-356"
		value="not(ram:PayeeTradeParty/ram:SpecifiedLegalOrganization/ram:TradingBusinessName)"/>
	<param name="CII-SR-357"
		value="not(ram:PayeeTradeParty/ram:SpecifiedLegalOrganization/ram:PostalTradeAddress)"/>
	<param name="CII-SR-358"
		value="not(ram:PayeeTradeParty/ram:SpecifiedLegalOrganization/ram:AuthorizedLegalRegistration)"/>
	<param name="CII-SR-359" value="not(ram:PayeeTradeParty/ram:DefinedTradeContact)"/>
	<param name="CII-SR-360" value="not(ram:PayeeTradeParty/ram:PostalTradeAddress)"/>
	<param name="CII-SR-361" value="not(ram:PayeeTradeParty/ram:URIUniversalCommunication)"/>
	<param name="CII-SR-362" value="not(ram:PayeeTradeParty/ram:SpecifiedTaxRegistration)"/>
	<param name="CII-SR-363" value="not(ram:PayeeTradeParty/ram:EndPointURIUniversalCommunication)"/>
	<param name="CII-SR-364" value="not(ram:PayeeTradeParty/ram:LogoAssociatedSpecifiedBinaryFile)"/>
	<param name="CII-SR-451"
		value="(not(ram:PayeeTradeParty/ram:ID) and ram:PayeeTradeParty/ram:GlobalID) or (ram:PayeeTradeParty/ram:ID and not(ram:PayeeTradeParty/ram:GlobalID)) or (not(ram:PayeeTradeParty/ram:ID) and not(ram:PayeeTradeParty/ram:GlobalID))"/>

	<param name="CII-SR-365" value="not(ram:PayerTradeParty)"/>
	<param name="CII-SR-366" value="not(ram:TaxApplicableTradeCurrencyExchange)"/>
	<param name="CII-SR-367" value="not(ram:InvoiceApplicableTradeCurrencyExchange)"/>
	<param name="CII-SR-368" value="not(ram:PaymentApplicableTradeCurrencyExchange)"/>

	<param name="CII-SR-369"
		value="not(ram:SpecifiedTradeSettlementPaymentMeans/ram:PaymentChannelCode)"/>
	<param name="CII-SR-370"
		value="not(ram:SpecifiedTradeSettlementPaymentMeans/ram:GuaranteeMethodCode)"/>
	<param name="CII-SR-371"
		value="not(ram:SpecifiedTradeSettlementPaymentMeans/ram:PaymentMethodCode)"/>
	<param name="CII-SR-443" value="not(ram:SpecifiedTradeSettlementPaymentMeans/ram:ID)"/>
	<param name="CII-SR-372"
		value="not(ram:SpecifiedTradeSettlementPaymentMeans/ram:ApplicableTradeSettlementFinancialCard/ram:MicrochipIndicator)"/>
	<param name="CII-SR-373"
		value="not(ram:SpecifiedTradeSettlementPaymentMeans/ram:ApplicableTradeSettlementFinancialCard/ram:TypeCode)"/>

	<param name="CII-SR-375"
		value="not(ram:SpecifiedTradeSettlementPaymentMeans/ram:ApplicableTradeSettlementFinancialCard/ram:ExpiryDate)"/>
	<param name="CII-SR-376"
		value="not(ram:SpecifiedTradeSettlementPaymentMeans/ram:ApplicableTradeSettlementFinancialCard/ram:VerificationNumeric)"/>
	<param name="CII-SR-377"
		value="not(ram:SpecifiedTradeSettlementPaymentMeans/ram:ApplicableTradeSettlementFinancialCard/ram:ValidFromDateTime)"/>
	<param name="CII-SR-378"
		value="not(ram:SpecifiedTradeSettlementPaymentMeans/ram:ApplicableTradeSettlementFinancialCard/ram:CreditLimitAmount)"/>
	<param name="CII-SR-379"
		value="not(ram:SpecifiedTradeSettlementPaymentMeans/ram:ApplicableTradeSettlementFinancialCard/ram:CreditAvailableAmount)"/>
	<param name="CII-SR-380"
		value="not(ram:SpecifiedTradeSettlementPaymentMeans/ram:ApplicableTradeSettlementFinancialCard/ram:InterestRatePercent)"/>
	<param name="CII-SR-381"
		value="not(ram:SpecifiedTradeSettlementPaymentMeans/ram:ApplicableTradeSettlementFinancialCard/ram:Description)"/>
	<param name="CII-SR-382"
		value="not(ram:SpecifiedTradeSettlementPaymentMeans/ram:PayerPartyDebtorFinancialAccount/ram:AccountName)"/>
	<param name="CII-SR-444"
		value="not(ram:SpecifiedTradeSettlementPaymentMeans/ram:PayerPartyDebtorFinancialAccount/ram:ProprietaryID)"/>

	<param name="CII-SR-384"
		value="not(ram:SpecifiedTradeSettlementPaymentMeans/ram:PayerSpecifiedDebtorFinancialInstitution/ram:ClearingSystemName)"/>
	<param name="CII-SR-385"
		value="not(ram:SpecifiedTradeSettlementPaymentMeans/ram:PayerSpecifiedDebtorFinancialInstitution/ram:Name)"/>
	<param name="CII-SR-386"
		value="not(ram:SpecifiedTradeSettlementPaymentMeans/ram:PayerSpecifiedDebtorFinancialInstitution/ram:LocationFinancialInstitutionAddress)"/>


	<param name="CII-SR-388" value="not(ram:SpecifiedTradeAllowanceCharge/ram:ID)"/>
	<param name="CII-SR-389" value="not(ram:SpecifiedTradeAllowanceCharge/ram:SequenceNumeric)"/>
	<param name="CII-SR-390" value="not(ram:SpecifiedTradeAllowanceCharge/ram:BasisQuantity)"/>
	<param name="CII-SR-391" value="not(ram:SpecifiedTradeAllowanceCharge/ram:PrepaidIndicator)"/>
	<param name="CII-SR-392" value="not(ram:SpecifiedTradeAllowanceCharge/ram:UnitBasisAmount)"/>
	<param name="CII-SR-393" value="not(ram:SpecifiedTradeAllowanceCharge/ram:TypeCode)"/>
	<param name="CII-SR-394"
		value="not(ram:SpecifiedTradeAllowanceCharge/ram:ActualTradeCurrencyExchange)"/>
	<param name="CII-SR-395" value="not(ram:SubtotalCalculatedTradeTax)"/>
	<param name="CII-SR-396" value="not(ram:SpecifiedLogisticsServiceCharge)"/>

	<param name="CII-SR-397" value="not(ram:SpecifiedTradePaymentTerms/ram:ID)"/>
	<param name="CII-SR-398" value="not(ram:SpecifiedTradePaymentTerms/ram:FromEventCode)"/>
	<param name="CII-SR-399" value="not(ram:SpecifiedTradePaymentTerms/ram:SettlementPeriodMeasure)"/>
	<param name="CII-SR-400"
		value="not(ram:SpecifiedTradePaymentTerms/ram:DueDateDateTime/udt:DateTime)"/>
	<param name="CII-SR-401" value="not(ram:SpecifiedTradePaymentTerms/ram:TypeCode)"/>
	<param name="CII-SR-402" value="not(ram:SpecifiedTradePaymentTerms/ram:InstructionTypeCode)"/>

	<param name="CII-SR-404" value="not(ram:SpecifiedTradePaymentTerms/ram:PartialPaymentPercent)"/>
	<param name="CII-SR-405" value="not(ram:SpecifiedTradePaymentTerms/ram:PaymentMeansID)"/>
	<param name="CII-SR-406" value="not(ram:SpecifiedTradePaymentTerms/ram:PartialPaymentAmount)"/>
	<param name="CII-SR-407"
		value="not(ram:SpecifiedTradePaymentTerms/ram:ApplicableTradePaymentPenaltyTerms)"/>
	<param name="CII-SR-408"
		value="not(ram:SpecifiedTradePaymentTerms/ram:ApplicableTradePaymentDiscountTerms)"/>
	<param name="CII-SR-409" value="not(ram:SpecifiedTradePaymentTerms/ram:PayeeTradeParty)"/>

	<param name="CII-SR-421" value="not(ram:SpecifiedFinancialAdjustment)"/>
	<param name="CII-SR-422" value="not(ram:InvoiceReferencedDocument/ram:LineID)"/>
	<param name="CII-SR-423" value="not(ram:ProFormaInvoiceReferencedDocument)"/>
	<param name="CII-SR-424" value="not(ram:LetterOfCreditReferencedDocument)"/>
	<param name="CII-SR-425" value="not(ram:FactoringAgreementReferencedDocument)"/>
	<param name="CII-SR-426" value="not(ram:FactoringListReferencedDocument)"/>
	<param name="CII-SR-427" value="not(ram:PayableSpecifiedTradeAccountingAccount)"/>
	<param name="CII-SR-428"
		value="not(ram:ReceivableSpecifiedTradeAccountingAccount/ram:SetTriggerCode)"/>
	<param name="CII-SR-429" value="not(ram:ReceivableSpecifiedTradeAccountingAccount/ram:TypeCode)"/>
	<param name="CII-SR-430"
		value="not(ram:ReceivableSpecifiedTradeAccountingAccount/ram:AmountTypeCode)"/>
	<param name="CII-SR-431" value="not(ram:ReceivableSpecifiedTradeAccountingAccount/ram:Name)"/>
	<param name="CII-SR-432"
		value="not(ram:ReceivableSpecifiedTradeAccountingAccount/ram:CostReferenceDimensionPattern)"/>
	<param name="CII-SR-433" value="not(ram:PurchaseSpecifiedTradeAccountingAccount)"/>
	<param name="CII-SR-434" value="not(ram:SalesSpecifiedTradeAccountingAccount)"/>
	<param name="CII-SR-435" value="not(ram:SpecifiedTradeSettlementFinancialCard)"/>

	<param name="CII-SR-436" value="not(ram:SpecifiedAdvancePayment)"/>
	<param name="CII-SR-437" value="not(ram:UltimatePayeeTradeParty)"/>
	<param name="CII-SR-452" value="count(ram:SpecifiedTradePaymentTerms) &lt;= 1"/>
	<param name="CII-SR-453" value="count(ram:SpecifiedTradePaymentTerms/ram:Description) &lt;= 1"/>
	<param name="CII-SR-459" value="count(ram:SellerTradeParty/ram:URIUniversalCommunication) &lt;= 1"/>
	<param name="CII-SR-460" value="count(ram:BuyerTradeParty/ram:URIUniversalCommunication) &lt;= 1"/>
	<param name="CII-SR-461" value="count(ram:ApplicableTradeTax/ram:TaxPointDate) &lt;= 1"/>
	<param name="CII-SR-462" value="count(//ram:ApplicableTradeTax/ram:DueDateTypeCode) = 0 or count(distinct-values(//ram:ApplicableTradeTax/ram:DueDateTypeCode)) = 1"/>
	<param name="CII-SR-465" value="not(ram:SellerTradeParty/ram:DefinedTradeContact/ram:PersonName and ram:SellerTradeParty/ram:DefinedTradeContact/ram:DepartmentName)"/>
	<param name="CII-SR-466" value="not(ram:BuyerTradeParty/ram:DefinedTradeContact/ram:PersonName and ram:BuyerTradeParty/ram:DefinedTradeContact/ram:DepartmentName)"/>
	<param name="CII-SR-467" value="count(//ram:SpecifiedTradeSettlementPaymentMeans/ram:TypeCode[normalize-space(.) != normalize-space((//ram:SpecifiedTradeSettlementPaymentMeans/ram:TypeCode)[1])]) = 0"/>
	<param name="CII-SR-468" value="count(//ram:SpecifiedTradeSettlementPaymentMeans/ram:Information[normalize-space(.) != normalize-space((//ram:SpecifiedTradeSettlementPaymentMeans/ram:Information)[1])]) = 0"/>	
	<param name="CII-SR-469" value="count(//ram:ApplicableHeaderTradeSettlement/ram:PaymentReference) &lt;= 1"/>
	
	
	<!-- Invoice -->
	<param name="CII-SR-438" value="not(ram:ValuationBreakdownStatement)"/>

	<!-- SpecifiedTradeSettlementHeaderMonetarySummation -->

	<param name="CII-SR-411" value="not(ram:InformationAmount)"/>
	<param name="CII-SR-412" value="not(ram:TotalDiscountAmount)"/>
	<param name="CII-SR-413" value="not(ram:TotalAllowanceChargeAmount)"/>
	<param name="CII-SR-414" value="not(ram:RetailValueExcludingTaxInformationAmount)"/>
	<param name="CII-SR-415" value="not(ram:TotalDepositFeeInformationAmount)"/>
	<param name="CII-SR-416" value="not(ram:ProductValueExcludingTobaccoTaxInformationAmount)"/>
	<param name="CII-SR-417" value="not(ram:TotalRetailValueInformationAmount)"/>
	<param name="CII-SR-418" value="not(ram:GrossLineTotalAmount)"/>
	<param name="CII-SR-419" value="not(ram:NetLineTotalAmount)"/>
	<param name="CII-SR-420" value="not(ram:NetIncludingTaxesLineTotalAmount)"/>
	<param name="CII-SR-463" value="(ram:ChargeIndicator)"/>
	<param name="CII-SR-477" value="count(ram:LineTotalAmount) &lt;= 1"/>
	<param name="CII-SR-478" value="count(ram:ChargeTotalAmount) &lt;= 1"/>
	<param name="CII-SR-479" value="count(ram:AllowanceTotalAmount) &lt;= 1"/>
	<param name="CII-SR-480" value="count(ram:TaxBasisTotalAmount) &lt;= 1"/>
	<param name="CII-SR-481" value="count(ram:RoundingAmount) &lt;= 1"/>
	<param name="CII-SR-482" value="count(ram:GrandTotalAmount) &lt;= 1"/>
	<param name="CII-SR-483" value="count(ram:InformationAmount) &lt;= 1"/>
	<param name="CII-SR-484" value="count(ram:TotalPrepaidAmount) &lt;= 1"/>
	<param name="CII-SR-485" value="count(ram:TotalDiscountAmount) &lt;= 1"/>
	<param name="CII-SR-486" value="count(ram:TotalAllowanceChargeAmount) &lt;= 1"/>
	<param name="CII-SR-487" value="count(ram:DuePayableAmount) &lt;= 1"/>
	<param name="CII-SR-488" value="count(ram:RetailValueExcludingTaxInformationAmount) &lt;= 1"/>
	<param name="CII-SR-489" value="count(ram:TotalDepositFeeInformationAmount) &lt;= 1"/>
	<param name="CII-SR-490" value="count(ram:ProductValueExcludingTobaccoTaxInformationAmount) &lt;= 1"/>
	<param name="CII-SR-491" value="count(ram:TotalRetailValueInformationAmount) &lt;= 1"/>
	<param name="CII-SR-492" value="count(ram:GrossLineTotalAmount) &lt;= 1"/>
	<param name="CII-SR-493" value="count(ram:NetLineTotalAmount) &lt;= 1"/>
	<param name="CII-SR-494" value="count(ram:NetIncludingTaxesLineTotalAmount) &lt;= 1"/>
	<!-- ID Type -->
	<param name="CII-DT-001" value="not(@schemeName)"/>
	<param name="CII-DT-002" value="not(@schemeAgencyName)"/>
	<param name="CII-DT-003" value="not(@schemeDataURI)"/>
	<param name="CII-DT-004" value="not(@schemeURI)"/>
	<param name="CII-DT-101" value="not(@schemeName)"/>
	<param name="CII-DT-102" value="not(@schemeAgencyName)"/>
	<param name="CII-DT-103" value="not(@schemeDataURI)"/>
	<param name="CII-DT-104" value="not(@schemeURI)"/>
	<!-- ID Type without attributes -->
	<param name="CII-DT-005" value="not(@schemeID)"/>
	<param name="CII-DT-006" value="not(@schemeAgencyID)"/>
	<param name="CII-DT-007" value="not(@schemeVersionID)"/>
	<!-- CategoryCode without attributes -->
	<param name="CII-DT-045" value="not(@listID)"/>
	<param name="CII-DT-046" value="not(@listAgencyID)"/>
	<param name="CII-DT-047" value="not(@listVersionID)"/>
	<param name="CII-DT-048" value="not(@listURI)"/>
	<!-- TypeCode -->
	<param name="CII-DT-008" value="not(@name)"/>
	<param name="CII-DT-009" value="not(@listURI)"/>
	<!-- Type Code without attributes-->
	<param name="CII-DT-010" value="not(@listID)"/>
	<param name="CII-DT-011" value="not(@listAgencyID)"/>
	<param name="CII-DT-012" value="not(@listVersionID)"/>
	<param name="CII-DT-013" value="not(@languageID)"/>
	<param name="CII-DT-014" value="not(@languageLocaleID)"/>
	<!-- ReferencedDocumentType -->
	<param name="CII-DT-015"
		value="not(ram:URIID) or (self::ram:AdditionalReferencedDocument and ram:TypeCode='916') "/>
	<param name="CII-DT-016" value="not(ram:StatusCode)"/>
	<param name="CII-DT-017" value="not(ram:CopyIndicator)"/>
	<param name="CII-DT-018"
		value="not(ram:TypeCode) or (self::ram:AdditionalReferencedDocument) and (ram:TypeCode='50' or ram:TypeCode='130' or ram:TypeCode='916')"/>
	<param name="CII-DT-019" value="not(ram:GlobalID)"/>
	<param name="CII-DT-020" value="not(ram:RevisionID)"/>
	<param name="CII-DT-021"
		value="not(ram:Name) or (self::ram:AdditionalReferencedDocument and ram:TypeCode='916')"/>
	<param name="CII-DT-022"
		value="not(ram:AttachmentBinaryObject) or (self::ram:AdditionalReferencedDocument and ram:TypeCode='916')"/>
	<param name="CII-DT-023" value="not(ram:Information)"/>
	<param name="CII-DT-024"
		value="not(ram:ReferenceTypeCode) or (self::ram:AdditionalReferencedDocument and ram:TypeCode='130')"/>
	<param name="CII-DT-025" value="not(ram:SectionName)"/>
	<param name="CII-DT-026" value="not(ram:PreviousRevisionID)"/>
	<param name="CII-DT-027"
		value="not(ram:FormattedIssueDateTime) or self::ram:InvoiceReferencedDocument"/>
	<param name="CII-DT-028" value="not(ram:EffectiveSpecifiedPeriod)"/>
	<param name="CII-DT-029" value="not(ram:IssuerTradeParty)"/>
	<param name="CII-DT-030" value="not(ram:AttachedSpecifiedBinaryFile)"/>
	<!-- AmountType -->
	<param name="CII-DT-031" value="not(@currencyID)"/>
	<param name="CII-DT-032" value="not(@currencyCodeListVersionID)"/>
	<!-- QuantityType -->
	<param name="CII-DT-033"
		value="not(@unitCode) or (/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeDelivery/ram:BilledQuantity/@unitCode)"/>
	<param name="CII-DT-034" value="not(@unitCodeListID)"/>
	<param name="CII-DT-035" value="not(@unitCodeListAgencyID)"/>
	<param name="CII-DT-036" value="not(@unitCodeListAgencyName)"/>
	<!-- TradeTaxType -->
	<param name="CII-DT-037" value="not(ram:TypeCode) or (ram:TypeCode = 'VAT')"/>
	<param name="CII-DT-038" value="not(ram:CalculatedRate)"/>
	<param name="CII-DT-039" value="not(ram:CalculationSequenceNumeric)"/>
	<param name="CII-DT-040" value="not(ram:BasisQuantity)"/>
	<param name="CII-DT-041"
		value="not(ram:BasisAmount) or (ancestor::ram:ApplicableHeaderTradeSettlement)"/>
	<param name="CII-DT-042" value="not(ram:UnitBasisAmount)"/>
	<param name="CII-DT-043" value="not(ram:LineTotalBasisAmount)"/>
	<param name="CII-DT-044" value="not(ram:AllowanceChargeBasisAmount)"/>
	<param name="CII-DT-049" value="not(ram:CurrencyCode)"/>
	<param name="CII-DT-050" value="not(ram:Jurisdiction)"/>
	<param name="CII-DT-051" value="not(ram:CustomsDutyIndicator)"/>
	<param name="CII-DT-052" value="not(ram:ExemptionReasonCode) or self::ram:ApplicableTradeTax"/>
	<param name="CII-DT-098" value="not(ram:ExemptionReason) or self::ram:ApplicableTradeTax"/>
	<param name="CII-DT-053" value="not(ram:TaxBasisAllowanceRate)"/>
	<param name="CII-DT-054" value="not(ram:TaxPointDate)  or (ancestor::ram:ApplicableHeaderTradeSettlement)"/>
	<param name="CII-DT-055" value="not(ram:Type)"/>
	<param name="CII-DT-056" value="not(ram:InformationAmount)"/>
	<param name="CII-DT-057" value="not(ram:CategoryName)"/>
	<param name="CII-DT-058" value="not(ram:DueDateTypeCode) or (ancestor::ram:ApplicableHeaderTradeSettlement)"/>
	<param name="CII-DT-059" value="not(ram:RateApplicablePercent/@format)"/>
	<param name="CII-DT-060" value="not(ram:SpecifiedTradeAccountingAccount)"/>
	<param name="CII-DT-061" value="not(ram:ServiceSupplyTradeCountry)"/>
	<param name="CII-DT-062" value="not(ram:BuyerRepayableTaxSpecifiedTradeAccountingAccount)"/>
	<param name="CII-DT-063" value="not(ram:SellerPayableTaxSpecifiedTradeAccountingAccount)"/>
	<param name="CII-DT-064" value="not(ram:SellerRefundableTaxSpecifiedTradeAccountingAccount)"/>
	<param name="CII-DT-065" value="not(ram:BuyerDeductibleTaxSpecifiedTradeAccountingAccount)"/>
	<param name="CII-DT-066" value="not(ram:BuyerNonDeductibleTaxSpecifiedTradeAccountingAccount)"/>
	<param name="CII-DT-067" value="not(ram:PlaceApplicableTradeLocation)"/>
	<!-- BillingSpecifiedPeriodType -->
	<param name="CII-DT-068" value="not(ram:StartDateTime/udt:DateTime)"/>
	<param name="CII-DT-069" value="not(ram:DurationMeasure)"/>
	<param name="CII-DT-070" value="not(ram:InclusiveIndicator)"/>
	<param name="CII-DT-071" value="not(ram:Description)"/>
	<param name="CII-DT-072" value="not(ram:EndDateTime/udt:DateTime)"/>
	<param name="CII-DT-073" value="not(ram:CompleteDateTime)"/>
	<param name="CII-DT-074" value="not(ram:OpenIndicator)"/>
	<param name="CII-DT-075" value="not(ram:SeasonCode)"/>
	<param name="CII-DT-076" value="not(ram:ID)"/>
	<param name="CII-DT-077" value="not(ram:Name)"/>
	<param name="CII-DT-078" value="not(ram:SequenceNumeric)"/>
	<param name="CII-DT-079" value="not(ram:StartDateFlexibilityCode)"/>
	<param name="CII-DT-080" value="not(ram:ContinuousIndicator)"/>
	<param name="CII-DT-081" value="not(ram:PurposeCode)"/>
	<!-- PostalTradeAddressType -->
	<param name="CII-DT-082" value="not(ram:ID)"/>
	<param name="CII-DT-083" value="not(ram:PostOfficeBox)"/>
	<param name="CII-DT-084" value="not(ram:BuildingName)"/>
	<param name="CII-DT-086" value="not(ram:LineFour)"/>
	<param name="CII-DT-087" value="not(ram:LineFive)"/>
	<param name="CII-DT-088" value="not(ram:StreetName)"/>
	<param name="CII-DT-089" value="not(ram:CitySubDivisionName)"/>
	<param name="CII-DT-090" value="not(ram:CountryName)"/>
	<param name="CII-DT-091" value="not(ram:CountrySubDivisionID)"/>
	<param name="CII-DT-092" value="not(ram:AttentionOf)"/>
	<param name="CII-DT-093" value="not(ram:CareOf)"/>
	<param name="CII-DT-094" value="not(ram:BuildingNumber)"/>
	<param name="CII-DT-095" value="not(ram:DepartmentName)"/>
	<param name="CII-DT-096" value="not(ram:AdditionalStreetName)"/>
	<!-- DateTimeString -->
	<param name="CII-DT-097"
		value="matches(.,'^\s*(\d{4})(1[0-2]|0[1-9]){1}(3[01]|[12][0-9]|0[1-9]){1}\s*$')"/>

	<!-- Sections -->

	<param name="Invoice_line" value="/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem"/>
	<param name="AssociatedDocumentLineDocument" value="/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem/ram:AssociatedDocumentLineDocument"/>
	<param name="Invoice" value="/rsm:CrossIndustryInvoice"/>
	<param name="Document_Context" value="/rsm:CrossIndustryInvoice/rsm:ExchangedDocumentContext"/>
	<param name="DocumentContextParameter" value="//*[ends-with(name(), 'DocumentContextParameter')]"/>
	<param name="Exchanged_Document" value="/rsm:CrossIndustryInvoice/rsm:ExchangedDocument"/>
	<param name="Note_Exchanged_Document" value="/rsm:CrossIndustryInvoice/rsm:ExchangedDocument/ram:IncludedNote"/>
	<param name="IDTypeNoAttributes"
		value="/rsm:CrossIndustryInvoice/rsm:ExchangedDocumentContext/ram:GuidelineSpecifiedDocumentContextParameter/ram:ID |
           /rsm:CrossIndustryInvoice/rsm:ExchangedDocument/ram:ID |
           /rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem/ram:AssociatedDocumentLineDocument/ram:LineID |
           /rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedTradeProduct/ram:SellerAssignedID"/>
	<param name="IDType" value="//ram:*[ends-with(name(), 'ID')]"/>
	<param name="TypeCodeType" value="//ram:TypeCode"/>
	<param name="NoAttributesTypeCodeType"
		value="/rsm:CrossIndustryInvoice/rsm:ExchangedDocument/ram:TypeCode"/>
	<param name="CategoryCodeNoAttributes"
		value="/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeSettlement/ram:ApplicableTradeTax/ram:CategoryCode"/>
	<param name="SpecifiedTradeProduct"
		value="/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedTradeProduct"/>
	<param name="ReferencedDocumentType" value="//ram:*[ends-with(name(), 'ReferencedDocument')]"/>
	<param name="SpecifiedLineTradeAgreement"
		value="/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeAgreement"/>
	<param name="AmountType"
		value="//ram:*[ends-with(name(), 'Amount') and not (self::ram:TaxTotalAmount)]"/>
	<param name="QuantityType" value="//ram:*[ends-with(name(), 'Quantity')]"/>
	<param name="SpecifiedLineTradeDelivery"
		value="/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeDelivery"/>
	<param name="SpecifiedLineTradeSettlement"
		value="/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedLineTradeSettlement"/>
	<param name="TradeTaxType" value="//ram:*[ends-with(name(), 'TradeTax')]"/>
	<param name="BillingSpecifiedPeriodType" value="//ram:BillingSpecifiedPeriod"/>
	<param name="ApplicableHeaderTradeAgreement"
		value="/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement"/>
	<param name="ApplicableProductCharacteristic"
		value="/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:IncludedSupplyChainTradeLineItem/ram:SpecifiedTradeProduct/ram:ApplicableProductCharacteristic"/>
	<param name="PostalTradeAddressType" value="//ram:PostalTradeAddress"/>
	<param name="ApplicableHeaderTradeDelivery"
		value="/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeDelivery"/>
	<param name="ApplicableHeaderTradeSettlement"
		value="/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement"/>
	<param name="SpecifiedTradeAllowanceCharge" value="//ram:SpecifiedTradeAllowanceCharge"/>
	<param name="SpecifiedTradeSettlementHeaderMonetarySummation"
		value="/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeSettlement/ram:SpecifiedTradeSettlementHeaderMonetarySummation"/>
	<param name="DateTimeString" value="//udt:DateTimeString[@format = '102']"/>
	<param name="AppliedTradeAllowanceCharge"  value="//ram:GrossPriceProductTradePrice/ram:AppliedTradeAllowanceCharge"/>
	<param name="Specified_Trade_Settlement_PaymentMeans" value="//ram:SpecifiedTradeSettlementPaymentMeans"/>
</pattern>
