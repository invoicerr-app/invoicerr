/**
 * `ublToPeppolShDocument` in isolation — OFFLINE (no network): proves the extraction against a REAL
 * Peppol BIS UBL document this codebase's own `formats/peppol-bis-provider.ts` produces (the exact
 * artifact `peppol-sh-live.spec.ts` later feeds to the real sandbox), not a hand-typed XML fixture
 * that could drift from what the format provider actually emits.
 */
import { buildInvoiceDescriptor } from '../../descriptors/invoice.descriptor';
import { DocumentFormatParty } from '../../formats/format-provider';
import { peppolBisFormatProvider } from '../../formats/peppol-bis-provider';
import { ublToPeppolShDocument } from './peppol-sh-client';

const SELLER: DocumentFormatParty = {
  name: 'Muster GmbH',
  address: 'Musterstraße 1',
  city: 'Berlin',
  postalCode: '10117',
  country: 'Germany',
  email: 'contact@muster.example',
  phone: '+49301234567',
  partyIdentifiers: [{ scheme: 'VAT', value: 'DE123456789' }],
};

const BUYER: DocumentFormatParty = {
  name: 'Dupont Consulting SARL',
  address: '12 Rue de la Paix',
  city: 'Paris',
  postalCode: '75002',
  country: 'France',
  partyIdentifiers: [{ scheme: 'VAT', value: 'FR12345678901' }],
};

const descriptor = buildInvoiceDescriptor();

const DOCUMENT = {
  id: 'doc-1',
  displayNumber: 'INV-2026-0002',
  status: 'sent',
  data: {
    client: 'client-1',
    issueDate: '2026-08-30',
    dueDate: '2026-09-30',
    currency: 'EUR',
    buyerReference: 'PO-2026-00042',
    lines: [{ description: 'Beratungsleistung', quantity: 5, unit: 'hour', unitPrice: 200, vatRate: '19' }],
  },
};

describe('ublToPeppolShDocument', () => {
  it('extracts number/dates/currency/parties/lines from a REAL, valid Peppol BIS UBL document', async () => {
    const build = await peppolBisFormatProvider.build(descriptor, DOCUMENT, SELLER, BUYER);
    expect(build.validation.valid).toBe(true); // sanity: this fixture must itself be a valid artifact

    const xml = new TextDecoder('utf-8').decode(build.bytes);
    const payload = ublToPeppolShDocument(xml);

    expect(payload.type).toBe('invoice');
    expect(payload.number).toBe('INV-2026-0002');
    expect(payload.issue_date).toBe('2026-08-30');
    // `build-semantic-invoice.ts`'s own header: BT-9 (`cbc:DueDate`)/`cbc:PaymentDueDate` is
    // deliberately OMITTED by this bridge today (no `dueDate` field threaded into it) — this
    // extraction never invents one either.
    expect(payload.due_date).toBeUndefined();
    expect(payload.currency).toBe('EUR');
    expect(payload.from).toEqual({ name: 'Muster GmbH', tax_id: 'DE123456789' });
    expect(payload.to).toEqual({ name: 'Dupont Consulting SARL', tax_id: 'FR12345678901' });
    expect(payload.lines).toEqual([
      { description: 'Beratungsleistung', quantity: 5, unit_price: 200, tax_rate: 19, unit: 'HUR' },
    ]);
  });

  it('throws, named, on a document with no root element', () => {
    expect(() => ublToPeppolShDocument('not xml at all')).toThrow(/could not parse/);
  });

  it('throws, named, on an unsupported root element', () => {
    expect(() => ublToPeppolShDocument('<Foo xmlns="urn:x"/>')).toThrow(/unsupported UBL root element/);
  });

  it('throws, named, when a party has no tax ID', () => {
    const xml =
      '<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" ' +
      'xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" ' +
      'xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">' +
      '<cbc:ID>INV-1</cbc:ID><cbc:IssueDate>2026-01-01</cbc:IssueDate>' +
      '<cac:AccountingSupplierParty><cac:Party>' +
      '<cac:PartyLegalEntity><cbc:RegistrationName>Seller</cbc:RegistrationName></cac:PartyLegalEntity>' +
      '</cac:Party></cac:AccountingSupplierParty>' +
      '<cac:AccountingCustomerParty><cac:Party>' +
      '<cac:PartyLegalEntity><cbc:RegistrationName>Buyer</cbc:RegistrationName><cbc:CompanyID>BUY1</cbc:CompanyID></cac:PartyLegalEntity>' +
      '</cac:Party></cac:AccountingCustomerParty>' +
      '<cac:InvoiceLine><cac:InvoicedQuantity unitCode="C62">1</cac:InvoicedQuantity>' +
      '<cac:Item><cbc:Name>x</cbc:Name></cac:Item><cac:Price><cbc:PriceAmount>1</cbc:PriceAmount></cac:Price>' +
      '</cac:InvoiceLine>' +
      '</Invoice>';
    expect(() => ublToPeppolShDocument(xml)).toThrow(/missing a tax ID/);
  });
});
