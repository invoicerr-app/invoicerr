/**
 * The invoice → GOBL bridge in isolation. Pure function, no network: what it pins is the SHAPE the
 * live sandbox accepted on 2026-09-24 (see `invopop.live.spec.ts`), and the three decisions that are
 * easy to undo by accident - the unit key list, the VAT percentage rather than a rate key, and the
 * total that is deliberately NEVER emitted.
 */
import { SemanticPartyInput } from '../../formats/semantic/build-semantic-invoice';
import { GOBL_INVOICE_SCHEMA, buildGoblInvoice, goblUnitKey } from './gobl-invoice';

const SELLER: SemanticPartyInput = {
  name: 'Invoicerr Test Seller',
  address: '809 avenue du Languedoc',
  addressLine2: 'Batiment B',
  city: 'Millau',
  postalCode: '12100',
  country: 'France',
  email: 'seller@example.fr',
  phone: '+33123456789',
  iban: 'FR7630006000011234567890189',
  partyIdentifiers: [{ scheme: 'VAT', value: 'FR11123456782' }],
};

const BUYER: SemanticPartyInput = {
  name: 'Invoicerr Test Buyer',
  address: '1 rue de Tricatel',
  city: 'Paris',
  postalCode: '75001',
  country: 'France',
  partyIdentifiers: [{ scheme: 'VAT', value: 'FR82404847824' }],
};

function build(overrides?: Partial<Parameters<typeof buildGoblInvoice>[0]>) {
  return buildGoblInvoice({
    code: 'INV-2026-0042',
    issueDate: '2026-09-24',
    dueDate: '2026-10-24',
    currency: 'EUR',
    seller: SELLER,
    buyer: BUYER,
    lines: [
      { description: 'Consulting services', quantity: 2, unit: 'hour', unitPrice: 100, vatRatePercent: 20 },
    ],
    ...overrides,
  });
}

describe('goblUnitKey', () => {
  it('translates the free-text units the invoice form itself proposes', () => {
    expect(goblUnitKey('hour')).toBe('h');
    expect(goblUnitKey('Hours')).toBe('h');
    expect(goblUnitKey(' day ')).toBe('day');
    expect(goblUnitKey('kg')).toBe('kg');
    expect(goblUnitKey('unit')).toBe('unit');
  });

  it('returns undefined rather than guessing for anything it does not know', () => {
    // The whole point: an unrecognised unit costs a descriptive attribute, while passing it through
    // costs the deposit - the sandbox rejects an invalid `item.unit` with GOBL-ORG-ITEM-04 and takes
    // the entire invoice down with it (verified live 2026-09-24).
    expect(goblUnitKey('journée')).toBeUndefined();
    expect(goblUnitKey('forfait')).toBeUndefined();
    expect(goblUnitKey('')).toBeUndefined();
    expect(goblUnitKey(null)).toBeUndefined();
  });
});

describe('buildGoblInvoice', () => {
  it('emits the document shape the sandbox accepted', () => {
    const doc = build();
    expect(doc.$schema).toBe(GOBL_INVOICE_SCHEMA);
    expect(doc.code).toBe('INV-2026-0042');
    expect(doc.issue_date).toBe('2026-09-24');
    expect(doc.currency).toBe('EUR');
    expect(doc.supplier).toMatchObject({
      name: 'Invoicerr Test Seller',
      tax_id: { country: 'FR', code: 'FR11123456782' },
      addresses: [
        {
          street: '809 avenue du Languedoc',
          street_extra: 'Batiment B',
          locality: 'Millau',
          code: '12100',
          country: 'FR',
        },
      ],
      emails: [{ addr: 'seller@example.fr' }],
      telephones: [{ num: '+33123456789' }],
    });
    expect(doc.customer).toMatchObject({ tax_id: { country: 'FR', code: 'FR82404847824' } });
  });

  it('NEVER emits totals - GOBL recomputes them and silently replaces anything supplied', () => {
    const doc = build();
    expect(doc.totals).toBeUndefined();
    const lines = doc.lines as Record<string, unknown>[];
    expect(lines[0].sum).toBeUndefined();
    expect(lines[0].total).toBeUndefined();
  });

  it('sends the VAT PERCENTAGE this product resolved, never a rate key for the platform to resolve', () => {
    const lines = build().lines as Record<string, unknown>[];
    expect(lines[0].taxes).toEqual([{ cat: 'VAT', percent: '20.0%' }]);
  });

  it('emits a zero-rated line as an explicit 0%, and an UNRESOLVED rate as no taxes at all', () => {
    const zero = build({
      lines: [{ description: 'Export', quantity: 1, unitPrice: 50, vatRatePercent: 0 }],
    }).lines as Record<string, unknown>[];
    expect(zero[0].taxes).toEqual([{ cat: 'VAT', percent: '0.0%' }]);

    const unresolved = build({
      lines: [{ description: 'Export', quantity: 1, unitPrice: 50, vatRatePercent: null }],
    }).lines as Record<string, unknown>[];
    // An unresolved rate is NOT a 0% rate - inventing one here would be inventing a tax treatment.
    expect(unresolved[0].taxes).toBeUndefined();
  });

  it('carries money as decimal strings at the currency precision, never as JSON numbers', () => {
    const lines = build({
      lines: [{ description: 'x', quantity: 3, unitPrice: 1.5, vatRatePercent: 20 }],
    }).lines as Record<string, unknown>[];
    expect((lines[0].item as Record<string, unknown>).price).toBe('1.50');
    expect(lines[0].quantity).toBe('3');
  });

  it('omits an unrecognised unit instead of passing it through', () => {
    const lines = build({
      lines: [{ description: 'x', quantity: 1, unit: 'journée', unitPrice: 1, vatRatePercent: 20 }],
    }).lines as Record<string, unknown>[];
    expect(lines[0].item).not.toHaveProperty('unit');
  });

  it('emits a discount as a percentage, and omits the block entirely at 0', () => {
    const discounted = build({
      lines: [{ description: 'x', quantity: 1, unitPrice: 100, discountPercent: 10, vatRatePercent: 20 }],
    }).lines as Record<string, unknown>[];
    expect(discounted[0].discounts).toEqual([{ percent: '10.0%' }]);

    const none = build({
      lines: [{ description: 'x', quantity: 1, unitPrice: 100, discountPercent: 0, vatRatePercent: 20 }],
    }).lines as Record<string, unknown>[];
    expect(none[0].discounts).toBeUndefined();
  });

  it('puts the due date and the seller IBAN under `payment`, and omits the block when neither exists', () => {
    expect(build().payment).toEqual({
      terms: { due_dates: [{ date: '2026-10-24', percent: '100%' }] },
      instructions: { key: 'credit-transfer', credit_transfer: [{ iban: 'FR7630006000011234567890189' }] },
    });

    const bare = build({ dueDate: null, seller: { ...SELLER, iban: null } });
    expect(bare.payment).toBeUndefined();
  });

  it('keeps the country on `tax_id` even when the party has no VAT identifier - the country is what selects the regime', () => {
    const doc = build({ buyer: { ...BUYER, partyIdentifiers: [] } });
    expect(doc.customer).toMatchObject({ tax_id: { country: 'FR' } });
    expect((doc.customer as Record<string, unknown>).tax_id).not.toHaveProperty('code');
  });

  it('omits `tax_id` entirely for a party with neither a country nor a VAT identifier', () => {
    const doc = build({ buyer: { ...BUYER, country: null, partyIdentifiers: [] } });
    expect(doc.customer).not.toHaveProperty('tax_id');
  });

  it('emits the document notes as a general GOBL note, and nothing for blank text', () => {
    expect(build({ notes: 'Thank you' }).notes).toEqual([{ key: 'general', text: 'Thank you' }]);
    expect(build({ notes: '   ' }).notes).toBeUndefined();
  });
});
