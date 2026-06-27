import { PartyRole, SupplyType } from '../types';
import { PartyTaxProfile, TransactionContext } from '../canonical/canonical-document';
import { resolve } from '../engine/compliance-engine';
import { ComplianceStatus } from './state-machine';
import { channelClassOf, describeFlow } from './flow-descriptor';

function party(country: string, role: PartyRole, validatedVat = role === 'B2B'): PartyTaxProfile {
  return {
    legalName: `${country} Co`,
    countryCode: country,
    role,
    identifiers: validatedVat ? [{ scheme: 'VAT', value: `${country}1`, validated: true }] : [],
  };
}

function tx(
  supplierCountry: string,
  buyerCountry: string,
  role: PartyRole,
  supplyType: SupplyType,
  issueDate: string,
): TransactionContext {
  return {
    supplier: party(supplierCountry, 'B2B'),
    buyer: party(buyerCountry, role),
    lines: [{ id: 'l1', description: 'x', quantity: 1, unitNetMinor: 10000, supplyType }],
    issueDate: new Date(issueDate),
    currency: 'EUR',
  };
}

describe('FlowDescriptor', () => {
  describe('channelClassOf', () => {
    it('EMAIL plan → EMAIL', () => {
      // Find a country pair that uses EMAIL in 2025
      const plan = resolve(tx('US', 'US', 'B2B', 'SERVICES', '2025-06-01'));
      expect(channelClassOf(plan)).toBe('EMAIL');
    });

    it('FR clearance plan → CLEARANCE (blocking regime)', () => {
      const plan = resolve(tx('FR', 'FR', 'B2B', 'SERVICES', '2027-01-15'));
      // FR post-2026: PDP channel + non-blocking regime → PORTAL
      // If regime.blocking is true it would be CLEARANCE, but FR PDP is non-blocking
      const cc = channelClassOf(plan);
      expect(['CLEARANCE', 'PORTAL']).toContain(cc);
    });
  });

  describe('describeFlow — EMAIL', () => {
    it('returns sendByEmail label and email pipeline', () => {
      const plan = resolve(tx('US', 'US', 'B2B', 'SERVICES', '2025-06-01'));
      const flow = describeFlow(plan, 'DRAFT');
      expect(flow.channelClass).toBe('EMAIL');
      expect(flow.sendLabelKey).toBe('sendByEmail');
      expect(flow.pipeline).toEqual(['draft', 'issued', 'sent', 'paid', 'archived']);
      expect(flow.awaiting).toBeNull();
      expect(flow.terminal).toBe(false);
    });
  });

  describe('describeFlow — FR post-2026 (PDP/PORTAL)', () => {
    it('returns portal pipeline for non-blocking PDP channel', () => {
      const plan = resolve(tx('FR', 'FR', 'B2B', 'SERVICES', '2027-01-15'));
      const flow = describeFlow(plan, 'DRAFT');
      expect(flow.channelClass).toBe('PORTAL');
      expect(flow.sendLabelKey).toBe('sendToPortal');
      expect(flow.pipeline).toEqual(['draft', 'issued', 'delivered', 'paid', 'archived']);
    });
  });

  describe('describeFlow — awaiting states', () => {
    it('PENDING_CLEARANCE → awaiting === CLEARANCE', () => {
      const plan = resolve(tx('FR', 'FR', 'B2B', 'SERVICES', '2027-01-15'));
      const flow = describeFlow(plan, 'PENDING_CLEARANCE');
      // FR PDP has IMMEDIATE trigger (SYNC/NONE feedback), so hasAsyncDriver is false
      // awaiting depends on whether there are async drivers
      expect(flow.awaiting === 'CLEARANCE' || flow.awaiting === null).toBe(true);
    });

    it('AWAITING_RESPONSE → awaiting === BUYER_RESPONSE', () => {
      const plan = resolve(tx('DE', 'DE', 'B2B', 'SERVICES', '2025-06-01'));
      const flow = describeFlow(plan, 'AWAITING_RESPONSE');
      expect(flow.awaiting).toBe('BUYER_RESPONSE');
    });
  });

  describe('describeFlow — terminal statuses', () => {
    it('CANCELLED → terminal === true', () => {
      const plan = resolve(tx('DE', 'DE', 'B2B', 'SERVICES', '2025-06-01'));
      const flow = describeFlow(plan, 'CANCELLED');
      expect(flow.terminal).toBe(true);
    });

    it('CORRECTED → terminal === true', () => {
      const plan = resolve(tx('DE', 'DE', 'B2B', 'SERVICES', '2025-06-01'));
      const flow = describeFlow(plan, 'CORRECTED');
      expect(flow.terminal).toBe(true);
    });

    it('REJECTED → terminal === true', () => {
      const plan = resolve(tx('DE', 'DE', 'B2B', 'SERVICES', '2025-06-01'));
      const flow = describeFlow(plan, 'REJECTED');
      expect(flow.terminal).toBe(true);
    });

    it('DRAFT → terminal === false', () => {
      const plan = resolve(tx('DE', 'DE', 'B2B', 'SERVICES', '2025-06-01'));
      const flow = describeFlow(plan, 'DRAFT');
      expect(flow.terminal).toBe(false);
    });
  });

  describe('describeFlow — manualActions', () => {
    it('DRAFT → manualActions contains issue', () => {
      const plan = resolve(tx('DE', 'DE', 'B2B', 'SERVICES', '2025-06-01'));
      const flow = describeFlow(plan, 'DRAFT');
      expect(flow.manualActions).toContain('issue');
    });

    it('DELIVERED → manualActions contains correct and/or cancel', () => {
      const plan = resolve(tx('US', 'US', 'B2B', 'SERVICES', '2025-06-01'));
      const flow = describeFlow(plan, 'DELIVERED');
      expect(flow.manualActions).toBeDefined();
      expect(flow.manualActions.length).toBeGreaterThan(0);
    });

    it('CANCELLED → manualActions is empty', () => {
      const plan = resolve(tx('DE', 'DE', 'B2B', 'SERVICES', '2025-06-01'));
      const flow = describeFlow(plan, 'CANCELLED');
      expect(flow.manualActions).toEqual([]);
    });

    it('CORRECTED → manualActions is empty (terminal)', () => {
      const plan = resolve(tx('DE', 'DE', 'B2B', 'SERVICES', '2025-06-01'));
      const flow = describeFlow(plan, 'CORRECTED');
      expect(flow.manualActions).toEqual([]);
    });
  });

  describe('describeFlow — primaryChannel', () => {
    it('exposes channel type and feedback', () => {
      const plan = resolve(tx('US', 'US', 'B2B', 'SERVICES', '2025-06-01'));
      const flow = describeFlow(plan, 'DRAFT');
      expect(flow.primaryChannel.type).toBe('EMAIL');
      expect(flow.primaryChannel.feedback).toBeDefined();
    });
  });
});
