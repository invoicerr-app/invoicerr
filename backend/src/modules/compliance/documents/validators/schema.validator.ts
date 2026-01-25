import { Injectable, Logger } from '@nestjs/common';
import { DOMParser } from '@xmldom/xmldom';

// Use xmldom's Document type which differs from the browser DOM
type XMLDocument = ReturnType<DOMParser['parseFromString']>;

/**
 * Supported e-invoice format types for XSD validation
 */
export type EInvoiceFormat =
  | 'UBL'
  | 'CII'
  | 'FACTURX'
  | 'ZUGFERD'
  | 'FATTURAPA'
  | 'FACTURAE'
  | 'XRECHNUNG'
  | 'PEPPOL';

/**
 * Validation error detail
 */
export interface ValidationError {
  line?: number;
  column?: number;
  message: string;
  severity: 'error' | 'warning';
  path?: string;
}

/**
 * Result of schema validation
 */
export interface SchemaValidationResult {
  valid: boolean;
  format: EInvoiceFormat;
  errors: ValidationError[];
  warnings: ValidationError[];
  schemaVersion?: string;
  validatedAt: Date;
}

/**
 * Schema definition for a format
 */
interface SchemaDefinition {
  format: EInvoiceFormat;
  namespace: string;
  rootElement: string;
  version?: string;
  schemaUrl?: string;
}

/**
 * XSD Schema Validator Service
 *
 * Validates XML documents against XSD schemas for various e-invoice formats:
 * - UBL 2.1 (Peppol BIS, XRechnung, etc.)
 * - CII D16B (Factur-X, ZUGFeRD)
 * - FatturaPA 1.2 (Italian SDI)
 * - Facturae 3.2 (Spanish)
 *
 * Provides structural validation, namespace checking, and format detection.
 */
@Injectable()
export class SchemaValidator {
  private readonly logger = new Logger(SchemaValidator.name);

  /**
   * Known schema definitions for e-invoice formats
   */
  private readonly schemaDefinitions: SchemaDefinition[] = [
    {
      format: 'UBL',
      namespace: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
      rootElement: 'Invoice',
      version: '2.1',
    },
    {
      format: 'CII',
      namespace: 'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100',
      rootElement: 'CrossIndustryInvoice',
      version: 'D16B',
    },
    {
      format: 'FACTURX',
      namespace: 'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100',
      rootElement: 'CrossIndustryInvoice',
      version: '1.0',
    },
    {
      format: 'ZUGFERD',
      namespace: 'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100',
      rootElement: 'CrossIndustryInvoice',
      version: '2.2',
    },
    {
      format: 'FATTURAPA',
      namespace: 'http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2',
      rootElement: 'FatturaElettronica',
      version: '1.2.2',
    },
    {
      format: 'FACTURAE',
      namespace: 'http://www.facturae.gob.es/formato/Versiones/Facturaev3_2_2.xml',
      rootElement: 'Facturae',
      version: '3.2.2',
    },
    {
      format: 'XRECHNUNG',
      namespace: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
      rootElement: 'Invoice',
      version: '3.0',
    },
    {
      format: 'PEPPOL',
      namespace: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
      rootElement: 'Invoice',
      version: '3.0',
    },
  ];

  /**
   * Required namespaces for each format
   */
  private readonly requiredNamespaces: Record<EInvoiceFormat, string[]> = {
    UBL: [
      'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
      'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
      'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
    ],
    CII: [
      'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100',
      'urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100',
    ],
    FACTURX: [
      'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100',
      'urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100',
    ],
    ZUGFERD: [
      'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100',
      'urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100',
    ],
    FATTURAPA: ['http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2'],
    FACTURAE: ['http://www.facturae.gob.es/formato/Versiones/Facturaev3_2_2.xml'],
    XRECHNUNG: [
      'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
      'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
    ],
    PEPPOL: [
      'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
      'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
    ],
  };

  /**
   * Validate XML string against XSD schema for specified format
   *
   * @param xml - XML string to validate
   * @param format - Target e-invoice format
   * @returns Validation result with errors if any
   */
  async validate(xml: string, format: EInvoiceFormat): Promise<SchemaValidationResult> {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];
    const validatedAt = new Date();

    try {
      // Parse XML document
      const parseErrors: ValidationError[] = [];
      const doc = this.parseXml(xml, parseErrors);

      if (parseErrors.length > 0) {
        return {
          valid: false,
          format,
          errors: parseErrors,
          warnings: [],
          validatedAt,
        };
      }

      if (!doc || !doc.documentElement) {
        errors.push({
          message: 'Failed to parse XML document or document is empty',
          severity: 'error',
        });
        return { valid: false, format, errors, warnings, validatedAt };
      }

      // Validate document structure
      const structureResult = this.validateStructure(doc, format);
      errors.push(...structureResult.errors);
      warnings.push(...structureResult.warnings);

      // Validate namespaces
      const namespaceResult = this.validateNamespaces(doc, format);
      errors.push(...namespaceResult.errors);
      warnings.push(...namespaceResult.warnings);

      // Format-specific validation
      const formatResult = await this.validateFormatSpecific(doc, format);
      errors.push(...formatResult.errors);
      warnings.push(...formatResult.warnings);

      const schemaDefinition = this.schemaDefinitions.find((s) => s.format === format);

      return {
        valid: errors.length === 0,
        format,
        errors,
        warnings,
        schemaVersion: schemaDefinition?.version,
        validatedAt,
      };
    } catch (error) {
      this.logger.error(`Validation failed for format ${format}:`, error);
      errors.push({
        message: error instanceof Error ? error.message : 'Unknown validation error',
        severity: 'error',
      });
      return { valid: false, format, errors, warnings, validatedAt };
    }
  }

  /**
   * Detect the format of an XML document
   *
   * @param xml - XML string to analyze
   * @returns Detected format or null if unknown
   */
  detectFormat(xml: string): EInvoiceFormat | null {
    try {
      const parseErrors: ValidationError[] = [];
      const doc = this.parseXml(xml, parseErrors);

      if (!doc || !doc.documentElement) {
        return null;
      }

      const rootElement = doc.documentElement;
      const rootName = rootElement.localName || rootElement.nodeName;
      const namespace = rootElement.namespaceURI || '';

      // Match against known schemas
      for (const schema of this.schemaDefinitions) {
        if (schema.rootElement === rootName && namespace.includes(schema.namespace.split(':').pop() || '')) {
          // Differentiate between CII variants
          if (schema.format === 'CII') {
            const guidelineId = this.extractGuidelineId(doc);
            if (guidelineId?.includes('factur-x')) return 'FACTURX';
            if (guidelineId?.includes('zugferd')) return 'ZUGFERD';
            return 'CII';
          }
          // Differentiate between UBL variants
          if (schema.format === 'UBL') {
            const customizationId = this.extractCustomizationId(doc);
            if (customizationId?.includes('xrechnung')) return 'XRECHNUNG';
            if (customizationId?.includes('peppol')) return 'PEPPOL';
            return 'UBL';
          }
          return schema.format;
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Validate multiple XML documents
   *
   * @param documents - Array of XML strings with their expected formats
   * @returns Array of validation results
   */
  async validateBatch(
    documents: Array<{ xml: string; format: EInvoiceFormat }>,
  ): Promise<SchemaValidationResult[]> {
    return Promise.all(documents.map(({ xml, format }) => this.validate(xml, format)));
  }

  /**
   * Check if a format is supported
   */
  isFormatSupported(format: string): format is EInvoiceFormat {
    return this.schemaDefinitions.some(
      (s) => s.format === format.toUpperCase(),
    );
  }

  /**
   * Get list of supported formats
   */
  getSupportedFormats(): EInvoiceFormat[] {
    return this.schemaDefinitions.map((s) => s.format);
  }

  /**
   * Parse XML string into DOM document
   */
  private parseXml(xml: string, errors: ValidationError[]): XMLDocument | null {
    const errorHandler = (
      level: 'warning' | 'error' | 'fatalError',
      msg: string,
    ) => {
      if (level === 'warning') {
        errors.push({ message: msg, severity: 'warning' });
      } else {
        errors.push({
          message: level === 'fatalError' ? `Fatal: ${msg}` : msg,
          severity: 'error',
        });
      }
    };

    const parser = new DOMParser({ errorHandler });
    return parser.parseFromString(xml, 'application/xml');
  }

  /**
   * Validate document structure against expected format
   */
  private validateStructure(
    doc: XMLDocument,
    format: EInvoiceFormat,
  ): { errors: ValidationError[]; warnings: ValidationError[] } {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];

    const schemaDefinition = this.schemaDefinitions.find((s) => s.format === format);
    if (!schemaDefinition) {
      errors.push({
        message: `Unknown format: ${format}`,
        severity: 'error',
      });
      return { errors, warnings };
    }

    const rootElement = doc.documentElement;
    const rootName = rootElement.localName || rootElement.nodeName.split(':').pop();

    // Check root element name
    if (rootName !== schemaDefinition.rootElement) {
      errors.push({
        message: `Invalid root element: expected '${schemaDefinition.rootElement}', found '${rootName}'`,
        severity: 'error',
        path: '/',
      });
    }

    // Check for required elements based on format
    const requiredElements = this.getRequiredElements(format);
    for (const element of requiredElements) {
      if (!this.hasElement(doc, element.name, element.namespace)) {
        if (element.required) {
          errors.push({
            message: `Missing required element: ${element.name}`,
            severity: 'error',
            path: element.path,
          });
        } else {
          warnings.push({
            message: `Missing recommended element: ${element.name}`,
            severity: 'warning',
            path: element.path,
          });
        }
      }
    }

    return { errors, warnings };
  }

  /**
   * Validate namespaces are correct for the format
   */
  private validateNamespaces(
    doc: XMLDocument,
    format: EInvoiceFormat,
  ): { errors: ValidationError[]; warnings: ValidationError[] } {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];

    const requiredNs = this.requiredNamespaces[format] || [];
    const rootElement = doc.documentElement;

    // Collect all declared namespaces
    const declaredNamespaces = new Set<string>();
    const attrs = rootElement.attributes;
    for (let i = 0; i < attrs.length; i++) {
      const attr = attrs.item(i);
      if (attr?.name.startsWith('xmlns')) {
        declaredNamespaces.add(attr.value);
      }
    }

    // Add the default namespace if present
    if (rootElement.namespaceURI) {
      declaredNamespaces.add(rootElement.namespaceURI);
    }

    // Check required namespaces
    for (const ns of requiredNs) {
      // Check if any declared namespace contains the required one
      const found = Array.from(declaredNamespaces).some((declared) => declared.includes(ns.split('/').pop() || ''));
      if (!found) {
        warnings.push({
          message: `Missing or non-standard namespace: ${ns}`,
          severity: 'warning',
        });
      }
    }

    return { errors, warnings };
  }

  /**
   * Format-specific validation rules
   */
  private async validateFormatSpecific(
    doc: XMLDocument,
    format: EInvoiceFormat,
  ): Promise<{ errors: ValidationError[]; warnings: ValidationError[] }> {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];

    switch (format) {
      case 'UBL':
      case 'PEPPOL':
      case 'XRECHNUNG':
        this.validateUBL(doc, errors, warnings);
        break;
      case 'CII':
      case 'FACTURX':
      case 'ZUGFERD':
        this.validateCII(doc, errors, warnings);
        break;
      case 'FATTURAPA':
        this.validateFatturaPA(doc, errors, warnings);
        break;
      case 'FACTURAE':
        this.validateFacturae(doc, errors, warnings);
        break;
    }

    return { errors, warnings };
  }

  /**
   * UBL-specific validation
   */
  private validateUBL(
    doc: XMLDocument,
    errors: ValidationError[],
    warnings: ValidationError[],
  ): void {
    // Check for CustomizationID
    const customizationId = this.getElementText(doc, 'CustomizationID');
    if (!customizationId) {
      errors.push({
        message: 'Missing CustomizationID element',
        severity: 'error',
        path: '/Invoice/CustomizationID',
      });
    }

    // Check for ProfileID
    const profileId = this.getElementText(doc, 'ProfileID');
    if (!profileId) {
      warnings.push({
        message: 'Missing ProfileID element',
        severity: 'warning',
        path: '/Invoice/ProfileID',
      });
    }

    // Check for required party information
    const supplierParty = doc.getElementsByTagName('AccountingSupplierParty');
    if (supplierParty.length === 0) {
      errors.push({
        message: 'Missing AccountingSupplierParty',
        severity: 'error',
        path: '/Invoice/AccountingSupplierParty',
      });
    }

    const customerParty = doc.getElementsByTagName('AccountingCustomerParty');
    if (customerParty.length === 0) {
      errors.push({
        message: 'Missing AccountingCustomerParty',
        severity: 'error',
        path: '/Invoice/AccountingCustomerParty',
      });
    }

    // Check for monetary totals
    const legalMonetaryTotal = doc.getElementsByTagName('LegalMonetaryTotal');
    if (legalMonetaryTotal.length === 0) {
      errors.push({
        message: 'Missing LegalMonetaryTotal',
        severity: 'error',
        path: '/Invoice/LegalMonetaryTotal',
      });
    }
  }

  /**
   * CII/Factur-X/ZUGFeRD-specific validation
   */
  private validateCII(
    doc: XMLDocument,
    errors: ValidationError[],
    warnings: ValidationError[],
  ): void {
    // Check for ExchangedDocumentContext
    const documentContext = doc.getElementsByTagName('ExchangedDocumentContext');
    if (documentContext.length === 0) {
      // Try with namespace prefix
      const rsmContext = doc.getElementsByTagName('rsm:ExchangedDocumentContext');
      if (rsmContext.length === 0) {
        errors.push({
          message: 'Missing ExchangedDocumentContext',
          severity: 'error',
          path: '/CrossIndustryInvoice/ExchangedDocumentContext',
        });
      }
    }

    // Check for SupplyChainTradeTransaction
    const tradeTransaction =
      doc.getElementsByTagName('SupplyChainTradeTransaction').length > 0 ||
      doc.getElementsByTagName('rsm:SupplyChainTradeTransaction').length > 0;
    if (!tradeTransaction) {
      errors.push({
        message: 'Missing SupplyChainTradeTransaction',
        severity: 'error',
        path: '/CrossIndustryInvoice/SupplyChainTradeTransaction',
      });
    }

    // Check for GuidelineSpecifiedDocumentContextParameter
    const guidelineId = this.extractGuidelineId(doc);
    if (!guidelineId) {
      warnings.push({
        message: 'Missing GuidelineSpecifiedDocumentContextParameter',
        severity: 'warning',
        path: '/CrossIndustryInvoice/ExchangedDocumentContext/GuidelineSpecifiedDocumentContextParameter',
      });
    }
  }

  /**
   * FatturaPA-specific validation
   */
  private validateFatturaPA(
    doc: XMLDocument,
    errors: ValidationError[],
    _warnings: ValidationError[],
  ): void {
    // Check version attribute
    const rootElement = doc.documentElement;
    const versione = rootElement.getAttribute('versione');
    if (!versione) {
      errors.push({
        message: 'Missing versione attribute on root element',
        severity: 'error',
        path: '/FatturaElettronica/@versione',
      });
    } else if (!['FPR12', 'FPA12'].includes(versione)) {
      errors.push({
        message: `Invalid versione: ${versione}. Expected FPR12 or FPA12`,
        severity: 'error',
        path: '/FatturaElettronica/@versione',
      });
    }

    // Check for FatturaElettronicaHeader
    const header = doc.getElementsByTagName('FatturaElettronicaHeader');
    if (header.length === 0) {
      errors.push({
        message: 'Missing FatturaElettronicaHeader',
        severity: 'error',
        path: '/FatturaElettronica/FatturaElettronicaHeader',
      });
    }

    // Check for FatturaElettronicaBody
    const body = doc.getElementsByTagName('FatturaElettronicaBody');
    if (body.length === 0) {
      errors.push({
        message: 'Missing FatturaElettronicaBody',
        severity: 'error',
        path: '/FatturaElettronica/FatturaElettronicaBody',
      });
    }

    // Check for CedentePrestatore (seller)
    const cedente = doc.getElementsByTagName('CedentePrestatore');
    if (cedente.length === 0) {
      errors.push({
        message: 'Missing CedentePrestatore (seller)',
        severity: 'error',
        path: '/FatturaElettronica/FatturaElettronicaHeader/CedentePrestatore',
      });
    }

    // Check for CessionarioCommittente (buyer)
    const cessionario = doc.getElementsByTagName('CessionarioCommittente');
    if (cessionario.length === 0) {
      errors.push({
        message: 'Missing CessionarioCommittente (buyer)',
        severity: 'error',
        path: '/FatturaElettronica/FatturaElettronicaHeader/CessionarioCommittente',
      });
    }
  }

  /**
   * Facturae-specific validation
   */
  private validateFacturae(
    doc: XMLDocument,
    errors: ValidationError[],
    warnings: ValidationError[],
  ): void {
    // Check for FileHeader
    const fileHeader = doc.getElementsByTagName('FileHeader');
    if (fileHeader.length === 0) {
      errors.push({
        message: 'Missing FileHeader',
        severity: 'error',
        path: '/Facturae/FileHeader',
      });
    }

    // Check for Parties
    const parties = doc.getElementsByTagName('Parties');
    if (parties.length === 0) {
      errors.push({
        message: 'Missing Parties',
        severity: 'error',
        path: '/Facturae/Parties',
      });
    }

    // Check for Invoices
    const invoices = doc.getElementsByTagName('Invoices');
    if (invoices.length === 0) {
      errors.push({
        message: 'Missing Invoices',
        severity: 'error',
        path: '/Facturae/Invoices',
      });
    }

    // Check schema version
    const schemaVersion = this.getElementText(doc, 'SchemaVersion');
    if (schemaVersion && !schemaVersion.startsWith('3.2')) {
      warnings.push({
        message: `Schema version ${schemaVersion} may not be fully supported`,
        severity: 'warning',
        path: '/Facturae/FileHeader/SchemaVersion',
      });
    }
  }

  /**
   * Get required elements for a format
   */
  private getRequiredElements(
    format: EInvoiceFormat,
  ): Array<{ name: string; namespace?: string; path: string; required: boolean }> {
    const commonElements = [
      { name: 'ID', path: '/*/ID', required: true },
    ];

    switch (format) {
      case 'UBL':
      case 'PEPPOL':
      case 'XRECHNUNG':
        return [
          ...commonElements,
          { name: 'IssueDate', path: '/Invoice/IssueDate', required: true },
          { name: 'InvoiceTypeCode', path: '/Invoice/InvoiceTypeCode', required: true },
          { name: 'DocumentCurrencyCode', path: '/Invoice/DocumentCurrencyCode', required: true },
        ];
      case 'CII':
      case 'FACTURX':
      case 'ZUGFERD':
        return [
          { name: 'ExchangedDocument', path: '/CrossIndustryInvoice/ExchangedDocument', required: true },
        ];
      case 'FATTURAPA':
        return [
          { name: 'DatiTrasmissione', path: '/FatturaElettronica/FatturaElettronicaHeader/DatiTrasmissione', required: true },
        ];
      case 'FACTURAE':
        return [
          { name: 'FileHeader', path: '/Facturae/FileHeader', required: true },
        ];
      default:
        return commonElements;
    }
  }

  /**
   * Check if document has an element
   */
  private hasElement(doc: XMLDocument, localName: string, namespace?: string): boolean {
    // Try with namespace
    if (namespace) {
      const elements = doc.getElementsByTagNameNS(namespace, localName);
      if (elements.length > 0) return true;
    }
    // Try without namespace
    const elements = doc.getElementsByTagName(localName);
    if (elements.length > 0) return true;
    // Try with common prefixes
    const prefixes = ['cbc', 'cac', 'ram', 'rsm', 'udt', 'p'];
    for (const prefix of prefixes) {
      const prefixedElements = doc.getElementsByTagName(`${prefix}:${localName}`);
      if (prefixedElements.length > 0) return true;
    }
    return false;
  }

  /**
   * Get text content of first matching element
   */
  private getElementText(doc: XMLDocument, localName: string): string | null {
    // Try without namespace
    let elements = doc.getElementsByTagName(localName);
    if (elements.length > 0 && elements[0].textContent) {
      return elements[0].textContent;
    }
    // Try with common prefixes
    const prefixes = ['cbc', 'cac', 'ram', 'rsm', 'udt'];
    for (const prefix of prefixes) {
      elements = doc.getElementsByTagName(`${prefix}:${localName}`);
      if (elements.length > 0 && elements[0].textContent) {
        return elements[0].textContent;
      }
    }
    return null;
  }

  /**
   * Extract GuidelineID from CII document
   */
  private extractGuidelineId(doc: XMLDocument): string | null {
    // Try different paths
    const paths = [
      'GuidelineSpecifiedDocumentContextParameter',
      'ram:GuidelineSpecifiedDocumentContextParameter',
    ];
    for (const path of paths) {
      const elements = doc.getElementsByTagName(path);
      if (elements.length > 0) {
        const idElements = elements[0].getElementsByTagName('ram:ID');
        if (idElements.length > 0 && idElements[0].textContent) {
          return idElements[0].textContent;
        }
        const plainIdElements = elements[0].getElementsByTagName('ID');
        if (plainIdElements.length > 0 && plainIdElements[0].textContent) {
          return plainIdElements[0].textContent;
        }
      }
    }
    return null;
  }

  /**
   * Extract CustomizationID from UBL document
   */
  private extractCustomizationId(doc: XMLDocument): string | null {
    return this.getElementText(doc, 'CustomizationID');
  }
}
