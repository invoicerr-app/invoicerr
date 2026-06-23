import { DocumentLine, PartyTaxProfile } from '../canonical/canonical-document';
import { PartyRole, SupplyType } from '../types';
import { FR } from '../profiles/data/fr';
import { MX } from '../profiles/data/mx';
import { US } from '../profiles/data/us';
import { TrustFlagVatValidator } from './classification';
import { resolve } from './compliance-engine';
import { determineLineTax } from './tax-engine';

const vat = new TrustFlagVatValidator();

function party(country: string, role: PartyRole, validatedVat = role === 'B2B'): PartyTaxProfile {
  return {
    legalName: `${country} Co`,
    countryCode: country,
    role,
    identifiers: validatedVat ? [{ scheme: 'VAT', value: `${country}1`, validated: true }] : [],
  };
}

function line(supplyType: SupplyType): DocumentLine {
  return { id: 'l1', description: 'item', quantity: 1, unitNetMinor: 10000, supplyType };
}

function tx(supplier: string, buyer: string, role: PartyRole, supply: SupplyType, date: string) {
  return {
    supplier: party(supplier, 'B2B'),
    buyer: party(buyer, role),
    lines: [line(supply)],
    issueDate: new Date(date),
    currency: 'MXN',
  };
}

describe('Mexico — domestic tax (IVA)', () => {
  it('MX→MX: IVA 16% standard', () => {
    const t = determineLineTax(party('MX', 'B2B'), party('MX', 'B2B'), line('GOODS'), MX, vat, MX);
    expect(t.components[0].category).toBe('S');
    expect(t.components[0].rate).toBe(16);
    expect(t.components[0].jurisdiction).toBe('MX');
  });
});

describe('Mexico — CLEARANCE plan (the new regime path)', () => {
  const plan = resolve(tx('MX', 'MX', 'B2B', 'GOODS', '2024-06-01'));

  it('regime is blocking clearance', () => {
    expect(plan.regime.model).toBe('CLEARANCE');
    expect(plan.regime.blocking).toBe(true);
  });

  it('routes through a PAC and emits the national CFDI 4.0 format', () => {
    expect(plan.channels.map((c) => c.type)).toEqual(['PAC']);
    expect(plan.artifacts).toEqual(
      expect.arrayContaining([expect.objectContaining({ role: 'AUTHORITATIVE', syntax: 'CFDI', version: '4.0' })]),
    );
  });

  it('is immutable after clearance and cancellable only with authority ack + buyer consent', () => {
    expect(plan.lifecycle.immutableAfter).toBe('CLEARANCE');
    expect(plan.lifecycle.cancellation.requiresAuthorityAck).toBe(true);
    expect(plan.lifecycle.cancellation.requiresBuyerConsent).toBe(true);
  });

  it('archives the authoritative XML in-country (MX) for 5 years, signed', () => {
    expect(plan.archival.residency).toBe('MX');
    expect(plan.archival.retentionYears).toBe(5);
    expect(plan.archival.integrity).toBe('SIGNED');
  });

  it('numbers from authority-allocated folios and reports in the local tax currency', () => {
    // folio model lives on the profile (consumed by the FolioPool sub-system, see §11.2)
    expect(MX.numbering[0].value.model).toBe('AUTHORITY_RANGE');
    expect(MX.taxSystem.kind === 'VAT' && MX.taxSystem.requiresTaxCurrency).toBe('MXN');
  });

  it('temporal: an invoice before 2023-04-01 uses CFDI 3.3', () => {
    const old = resolve(tx('MX', 'MX', 'B2B', 'GOODS', '2022-01-10'));
    expect(old.artifacts[0]).toMatchObject({ syntax: 'CFDI', version: '3.3' });
  });
});

describe('Mexico — cross-border (a VAT country outside any tax union)', () => {
  it('MX→US goods: export, zero-rated (no intra-union concept applies)', () => {
    const t = determineLineTax(party('MX', 'B2B'), party('US', 'B2B'), line('GOODS'), MX, vat, US);
    expect(t.components[0].category).toBe('G');
    expect(t.components[0].rate).toBe(0);
  });

  it('MX→FR services: outside scope, buyer self-assesses', () => {
    const t = determineLineTax(party('MX', 'B2B'), party('FR', 'B2B'), line('SERVICES'), MX, vat, FR);
    expect(t.components[0].category).toBe('O');
    expect(t.buyerSelfAssess).toBe(true);
  });

  it('US→MX: no US tax; MX buyer self-assesses via buyer-profile VAT detection (no union table)', () => {
    const t = determineLineTax(party('US', 'B2B'), party('MX', 'B2B'), line('SERVICES'), US, vat, MX);
    expect(t.components[0].taxSystem).toBe('SALES_TAX');
    expect(t.components[0].rate).toBe(0);
    expect(t.buyerSelfAssess).toBe(true);
    expect(t.mentions.map((m) => m.code)).toContain('IMPORT_SELF_ASSESS');
  });

  it('MX↔US cross-border resolves at OFFICIAL confidence (both profiles implemented)', () => {
    expect(resolve(tx('MX', 'US', 'B2B', 'GOODS', '2024-06-01')).confidence).toBe('OFFICIAL');
  });
});
