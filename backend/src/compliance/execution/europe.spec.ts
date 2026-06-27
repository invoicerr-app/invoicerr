import { PartyRole, SupplyType } from '../types';
import { PartyTaxProfile, TransactionContext } from '../canonical/canonical-document';
import { resolve } from '../engine/compliance-engine';
import { NumberingRegistry } from '../lifecycle/numbering';
import { ComplianceExecutor } from './executor';
import { RecordingComplianceLogger } from './logger';

function party(country: string, role: PartyRole): PartyTaxProfile {
  return {
    legalName: `${country} Co`,
    countryCode: country,
    role,
    identifiers: role === 'B2B' ? [{ scheme: 'VAT', value: `${country}1`, validated: true }] : [],
  };
}

function tx(country: string, role: PartyRole, supply: SupplyType, date: string): TransactionContext {
  return {
    supplier: party(country, 'B2B'),
    buyer: party(country, role),
    lines: [{ id: 'l1', description: 'x', quantity: 1, unitNetMinor: 10000, supplyType: supply }],
    issueDate: new Date(date),
    currency: 'EUR',
  };
}

async function run(ctx: TransactionContext) {
  const log = new RecordingComplianceLogger();
  const executor = new ComplianceExecutor({ numbering: new NumberingRegistry(), logger: log });
  const plan = resolve(ctx);
  return { plan, result: await executor.execute(ctx, plan), log };
}

describe('Italy — SdI clearance (building blocks already shared)', () => {
  let plan: Awaited<ReturnType<typeof run>>['plan'];
  let result: Awaited<ReturnType<typeof run>>['result'];
  let log: Awaited<ReturnType<typeof run>>['log'];

  beforeAll(async () => {
    ({ plan, result, log } = await run(tx('IT', 'B2B', 'SERVICES', '2027-01-15')));
  });

  it('is a blocking clearance regime', () => {
    expect(plan.regime.model).toBe('CLEARANCE');
    expect(plan.regime.blocking).toBe(true);
  });
  it('builds FatturaPA and transmits via SdI', () => {
    expect(log.hasScope('format/fatturapa')).toBe(true);
    expect(log.hasScope('transmission/sdi')).toBe(true);
    expect(result.artifacts.some((a) => a.syntax === 'FATTURAPA')).toBe(true);
    expect(result.transmissions.some((t) => t.channel === 'SDI')).toBe(true);
  });
});

describe('Poland — KSeF selected via providerId (no portal collision)', () => {
  it('after the 2026 mandate: clearance, FA_VAT, routed specifically through KSeF (not the generic portal)', async () => {
    const { plan, result, log } = await run(tx('PL', 'B2B', 'GOODS', '2027-01-15'));
    expect(plan.regime.model).toBe('CLEARANCE');
    expect(plan.channels[0]).toMatchObject({ type: 'GOV_PORTAL_API', providerId: 'ksef' });
    expect(log.hasScope('transmission/ksef')).toBe(true);
    expect(log.hasScope('transmission/gov-portal')).toBe(false);
    expect(log.hasScope('format/fa-vat')).toBe(true);
    expect(result.artifacts.some((a) => a.syntax === 'FA_VAT')).toBe(true);
  });

  it('before the mandate: post-audit over email', async () => {
    const { plan, log } = await run(tx('PL', 'B2B', 'GOODS', '2025-06-01'));
    expect(plan.regime.model).toBe('POST_AUDIT');
    expect(log.hasScope('transmission/email')).toBe(true);
    expect(log.hasScope('transmission/ksef')).toBe(false);
  });
});
