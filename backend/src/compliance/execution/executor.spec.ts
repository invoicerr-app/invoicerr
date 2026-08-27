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
async function run(ctx: TransactionContext) {
  const log = new RecordingComplianceLogger();
  const executor = new ComplianceExecutor({ numbering: new NumberingRegistry(), logger: log });
  const plan = resolve(ctx);
  const result = await executor.execute(ctx, plan);
  return { plan, result, log };
}

describe('ComplianceExecutor — France (decentralized CTC)', () => {
  let result: Awaited<ReturnType<typeof run>>['result'];
  let log: Awaited<ReturnType<typeof run>>['log'];

  beforeAll(async () => {
    ({ result, log } = await run(tx('FR', 'FR', 'B2B', 'SERVICES', '2027-01-15')));
  });

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
  let result: Awaited<ReturnType<typeof run>>['result'];
  let log: Awaited<ReturnType<typeof run>>['log'];

  beforeAll(async () => {
    ({ result, log } = await run(tx('US', 'US', 'B2B', 'GOODS', '2027-01-15', 'CA')));
  });

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
  let result: Awaited<ReturnType<typeof run>>['result'];
  let log: Awaited<ReturnType<typeof run>>['log'];

  beforeAll(async () => {
    ({ result, log } = await run(tx('MX', 'MX', 'B2B', 'GOODS', '2024-06-01')));
  });

  it('builds the national CFDI format', () => {
    expect(log.hasScope('format/cfdi')).toBe(true);
    expect(result.artifacts.some((a) => a.syntax === 'CFDI')).toBe(true);
  });
  it('invokes the XAdES signer because clearance + signed archive are required', () => {
    // XAdES signer is invoked (executor selects XAdES algo for blocking/signed-archive plans).
    // In this test environment no cert is configured, so the signer logs a warn and passes
    // the artifact through unsigned. Real signing is proven in providers.spec.ts.
    expect(log.hasScope('signing/xades')).toBe(true);
    expect(result.signed.every((s) => !s.signature)).toBe(true);
  });
  it('submits to a PAC and is not yet cleared (async clearance)', () => {
    expect(log.hasScope('transmission/pac')).toBe(true);
    expect(result.regime.model).toBe('CLEARANCE');
    expect(result.regime.cleared).toBe(false);
    expect(result.regime.clearanceRequired).toBe(true);
  });
  it('archives in-country (MX WORM bucket) with a real content hash', () => {
    expect(result.archive?.region).toBe('MX');
    expect(result.archive?.providerId).toBe('s3-worm');
    // M-3: no more fabricated 'stub-sha256' — a real 64-hex-char SHA-256 over the signed artifacts.
    expect(result.archive?.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.archive?.uri).not.toContain('/stub');
  });
  // MX-D1: Mexico was requalified from AUTHORITY_RANGE to UNIQUE_SELF — `Serie`/`Folio` are
  // use="optional" in the SAT schema and the UUID is assigned per document at timbrado, so nothing
  // is pre-allocated and nothing should block. The "blocks until a folio range is loaded" contract
  // still matters and is still covered: it moved to the CL (SII/CAF) tests in
  // compliance-service.spec.ts, which is the shipped AUTHORITY_RANGE jurisdiction.
  it('numbers self-assigned, without waiting on any authority range', () => {
    expect(result.number).toBeDefined();
    expect(result.warnings.join(' ')).not.toMatch(/Numbering blocked|folio/i);
  });
  it('computes IVA totals (16%)', () => {
    expect(result.totals?.tax.minor).toBe(1600);
  });
});

describe('ComplianceExecutor — reporting side-effects', () => {
  it('FR→IT B2B services queues the EC Sales List', async () => {
    const { log } = await run(tx('FR', 'IT', 'B2B', 'SERVICES', '2027-01-15'));
    expect(log.hasScope('reporting/EC_SALES_LIST')).toBe(true);
  });
});

/**
 * Numbering double-consumption fix: issue() (ComplianceService) already allocates the ONE
 * authoritative number for a document before send() ever runs execute() against it — and in prod
 * both share the SAME NumberingRegistry singleton (see the "2. Numbering" comment in executor.ts).
 * Before this fix, execute() unconditionally called numbering.next() again, burning a second
 * counter value (GAPLESS_SELF) or consuming a second folio (AUTHORITY_RANGE) per document — pure
 * waste, since execute()'s returned `number` was never read downstream. These tests prove the fix
 * directly at the executor level: when the caller passes `assignedNumber`, execute() reuses it
 * verbatim and never touches the numbering registry at all.
 */
describe('ComplianceExecutor — F-9 fix: opts.assignedNumber reuse skips (re-)allocation', () => {
  it('GAPLESS_SELF: returns assignedNumber verbatim and never increments the counter', async () => {
    const log = new RecordingComplianceLogger();
    const numbering = new NumberingRegistry();
    const executor = new ComplianceExecutor({ numbering, logger: log });
    const txCtx = tx('FR', 'FR', 'B2B', 'SERVICES', '2027-01-15');
    const plan = resolve(txCtx);

    const result = await executor.execute(txCtx, plan, { assignedNumber: 'PRE-ASSIGNED-1' });
    expect(result.number).toBe('PRE-ASSIGNED-1');

    // The counter was never touched by the call above — the very first live next() call on this
    // series still yields the series' FIRST value. A double-consume would have left it at '000002'.
    expect(numbering.get('GAPLESS_SELF').next('FR-INVOICE', plan.numbering, log).value).toBe('000001');
  });

  it('AUTHORITY_RANGE: returns assignedNumber verbatim and never consumes a folio (no ensureRange/next() call)', async () => {
    const log = new RecordingComplianceLogger();
    const numbering = new NumberingRegistry();
    numbering.folioPool.loadRange('CL-INVOICE', 1000, 1002);
    const executor = new ComplianceExecutor({ numbering, logger: log });
    const txCtx = tx('CL', 'CL', 'B2B', 'GOODS', '2024-06-01');
    const plan = resolve(txCtx);

    const result = await executor.execute(txCtx, plan, { assignedNumber: 'PRE-ASSIGNED-FOLIO' });
    expect(result.number).toBe('PRE-ASSIGNED-FOLIO');

    // The pool's cursor is untouched — the FIRST folio in the loaded range is still up next. A
    // double-consume would have left '1000' already burned and '1001' up next.
    expect(numbering.folioPool.next('CL-INVOICE', plan.numbering, log).value).toBe('1000');
  });

  it('with NO assignedNumber, standalone execute() still allocates a fresh number (unchanged behavior)', async () => {
    const { result } = await run(tx('FR', 'FR', 'B2B', 'SERVICES', '2027-01-15'));
    expect(result.number).toBe('000001');
  });
});
