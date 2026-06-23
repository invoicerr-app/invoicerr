import { PartyRole, SupplyType } from '../types';
import { PartyTaxProfile, TransactionContext } from '../canonical/canonical-document';
import { resolve } from '../engine/compliance-engine';
import { NumberingRegistry } from '../lifecycle/numbering';
import { ComplianceExecutor } from './executor';
import { RecordingComplianceLogger } from './logger';

function party(country: string, role: PartyRole, state?: string): PartyTaxProfile {
  return {
    legalName: `${country} Co`,
    countryCode: country,
    role,
    identifiers: role === 'B2B' ? [{ scheme: 'VAT', value: `${country}1`, validated: true }] : [],
    address: state
      ? { line1: '1 St', postalCode: '00000', city: 'C', subdivision: state, countryCode: country }
      : undefined,
  };
}

function tx(
  supplier: string,
  buyer: string,
  role: PartyRole,
  supply: SupplyType,
  date: string,
  buyerState?: string,
): TransactionContext {
  return {
    supplier: party(supplier, 'B2B'),
    buyer: party(buyer, role, buyerState),
    lines: [{ id: 'l1', description: 'x', quantity: 1, unitNetMinor: 10000, supplyType: supply }],
    issueDate: new Date(date),
    currency: 'EUR',
  };
}

/** Fresh executor per test so the in-memory numbering counters/folio pools are isolated. */
function run(ctx: TransactionContext) {
  const log = new RecordingComplianceLogger();
  const executor = new ComplianceExecutor({ numbering: new NumberingRegistry(), logger: log });
  const plan = resolve(ctx);
  const result = executor.execute(ctx, plan);
  return { plan, result, log };
}

describe('ComplianceExecutor — France (decentralized CTC)', () => {
  const { result, log } = run(tx('FR', 'FR', 'B2B', 'SERVICES', '2027-01-15'));

  it('builds Factur-X via the EN 16931 provider', () => {
    expect(log.hasScope('format/en16931')).toBe(true);
    expect(result.artifacts.some((a) => a.syntax === 'FACTURX')).toBe(true);
  });
  it('transmits over a PDP', () => {
    expect(log.hasScope('transmission/pdp')).toBe(true);
    expect(result.transmissions.some((t) => t.channel === 'PDP')).toBe(true);
  });
  it('computes VAT totals (20% of 100.00)', () => {
    expect(result.totals?.net.minor).toBe(10000);
    expect(result.totals?.tax.minor).toBe(2000);
    expect(result.totals?.gross.minor).toBe(12000);
  });
  it('does not qualified-sign (non-blocking, hash-chain archive)', () => {
    expect(log.hasScope('signing/xades')).toBe(false);
    expect(result.signed.every((s) => !s.signature)).toBe(true);
  });
  it('assigns a gapless number', () => {
    expect(result.number).toBeDefined();
  });
});

describe('ComplianceExecutor — United States (post-audit, sales tax)', () => {
  const { result, log } = run(tx('US', 'US', 'B2B', 'GOODS', '2027-01-15', 'CA'));

  it('builds a plain PDF and transmits by email', () => {
    expect(log.hasScope('format/plain-pdf')).toBe(true);
    expect(result.transmissions.map((t) => t.channel)).toContain('EMAIL');
  });
  it('applies the destination state sales-tax rate (CA 7.25%)', () => {
    expect(result.totals?.tax.minor).toBe(725);
  });
  it('does not sign', () => {
    expect(log.hasScope('signing/xades')).toBe(false);
  });
});

describe('ComplianceExecutor — Mexico (blocking clearance)', () => {
  const { result, log } = run(tx('MX', 'MX', 'B2B', 'GOODS', '2024-06-01'));

  it('builds the national CFDI format', () => {
    expect(log.hasScope('format/cfdi')).toBe(true);
    expect(result.artifacts.some((a) => a.syntax === 'CFDI')).toBe(true);
  });
  it('signs (XAdES) because clearance + signed archive are required', () => {
    expect(log.hasScope('signing/xades')).toBe(true);
    expect(result.signed.every((s) => s.signature?.algo === 'XAdES')).toBe(true);
  });
  it('submits to a PAC and is not yet cleared (async clearance)', () => {
    expect(log.hasScope('transmission/pac')).toBe(true);
    expect(result.regime.model).toBe('CLEARANCE');
    expect(result.regime.cleared).toBe(false);
    expect(result.regime.clearanceRequired).toBe(true);
  });
  it('archives in-country (MX WORM bucket)', () => {
    expect(result.archive?.region).toBe('MX');
    expect(result.archive?.providerId).toBe('s3-worm');
  });
  it('blocks numbering until a folio range is loaded (AUTHORITY_RANGE)', () => {
    expect(result.number).toBeUndefined();
    expect(result.warnings.join(' ')).toMatch(/Numbering blocked|folio/i);
  });
  it('computes IVA totals (16%)', () => {
    expect(result.totals?.tax.minor).toBe(1600);
  });
});

describe('ComplianceExecutor — reporting side-effects', () => {
  it('FR→IT B2B services queues the EC Sales List', () => {
    const { log } = run(tx('FR', 'IT', 'B2B', 'SERVICES', '2027-01-15'));
    expect(log.hasScope('reporting/ec-sales-list')).toBe(true);
  });
});
