/**
 * P2-T07 — the four French flows, each with the right obligation AND the right channels.
 *
 * The plan's acceptance table, asserted directly. Three of the four already passed after the
 * attachment predicates landed; the second did not, and it is the one this file exists for:
 *
 *   FR->FR B2C   obligation E_REPORTING   channels [PDP, GOV_PORTAL_API, PEPPOL]   <- wrong
 *
 * The regime was right and the routing was not, which is worse than both being wrong: the plan said
 * "this is a reporting obligation" and then offered the accredited-platform network to carry the
 * invoice. Art. 289 bis I covers the operations of art. 289 I 1 a and d — B2B and B2G — so a sale
 * to a consumer is not an in-scope invoice and has no business on a PDP. Not a preference: the
 * complement of the article's own scope.
 *
 * The channel a B2C invoice DOES use (email) is a product default and is marked as one in the
 * profile. No rule prescribes how an invoice reaches a consumer.
 */
import { primaryObligation, resolve } from './compliance-engine';

const ctx = (buyerCountry: string, role: string, supplyType = 'SERVICES', buyerVat?: string) =>
  ({
    supplier: {
      legalName: 'FR Co',
      countryCode: 'FR',
      role: 'B2B',
      identifiers: [{ scheme: 'VAT', value: 'FR12345678901', validated: true }],
    },
    buyer: {
      legalName: 'B',
      countryCode: buyerCountry,
      role,
      identifiers: buyerVat ? [{ scheme: 'VAT', value: buyerVat, validated: true }] : [],
    },
    lines: [{ id: 'l1', description: 'x', quantity: 1, unitNetMinor: 10000, supplyType }],
    issueDate: new Date('2027-01-15'),
    currency: 'EUR',
    externalRef: 'four-flows',
  }) as never;

const flow = (country: string, role: string, vat?: string) => {
  const plan = resolve(ctx(country, role, 'SERVICES', vat));
  return {
    obligation: primaryObligation(plan).kind,
    model: primaryObligation(plan).model,
    channels: plan.channels.map((c: { type: string }) => c.type),
  };
};

describe('P2-T07 — the four French flows', () => {
  it('FR->FR B2B: e-invoicing, and the PDP is the channel', () => {
    expect(flow('FR', 'B2B')).toEqual({
      obligation: 'E_INVOICING',
      model: 'DECENTRALIZED_CTC',
      channels: ['PDP', 'GOV_PORTAL_API', 'PEPPOL'],
    });
  });

  it('FR->FR B2C: e-reporting, and NO PDP — this is the line that was failing', () => {
    expect(flow('FR', 'B2C')).toEqual({
      obligation: 'E_REPORTING',
      model: 'REAL_TIME_REPORTING',
      channels: ['EMAIL'],
    });
  });

  it('FR->IT B2B: e-reporting, no PDP', () => {
    expect(flow('IT', 'B2B', 'IT12345678901')).toEqual({
      obligation: 'E_REPORTING',
      model: 'REAL_TIME_REPORTING',
      channels: ['EMAIL'],
    });
  });

  it('FR->US B2B: e-reporting, no PDP', () => {
    expect(flow('US', 'B2B')).toEqual({
      obligation: 'E_REPORTING',
      model: 'REAL_TIME_REPORTING',
      channels: ['EMAIL'],
    });
  });

  it('no flow is left without a channel — the lifecycle assembler reads channels[0]', () => {
    // The failure mode this guards is not a wrong channel but an absent one: filtering B2C out of
    // the CTC rule without giving it a rule of its own would match nothing and leave the plan with
    // an empty list, which assembler.ts cannot build a lifecycle from.
    for (const [c, r] of [
      ['FR', 'B2B'],
      ['FR', 'B2C'],
      ['IT', 'B2B'],
      ['US', 'B2B'],
      ['DE', 'B2C'],
      ['MC', 'B2B'],
    ]) {
      expect(`${c}/${r}: ${flow(c, r).channels.length > 0}`).toBe(`${c}/${r}: true`);
    }
  });

  it('B2G keeps the accredited network — the mandate covers it too (art. 289 I 1 d)', () => {
    expect(flow('FR', 'B2G').channels).toContain('PDP');
    expect(flow('FR', 'B2G').obligation).toBe('E_INVOICING');
  });
});
