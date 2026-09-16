/**
 * REAL round-trip against the Polar SANDBOX organization proving `checkout-tax-id.ts#resolveCheckoutTaxId`
 * and `checkout-session.ts`'s own 422 retry — the fix for a dev-instance incident (2026-09-16):
 * "Subscribe" opened a Polar checkout that immediately answered "The provided tax ID is invalid." for a
 * real micro-entreprise (`PartyIdentifier` VAT `FR54982187676`, checksum-valid — SIREN 982187676 mod 97
 * = 14, (12 + 3×14) mod 97 = 54 — and LEGAL_ID `98218767600019`), because Polar validates a checkout tax
 * id against VIES and a franchise-en-base trader has no active VIES entry no matter how well-formed its
 * VAT-shaped number looks.
 *
 * Gated the same as every other live spec (`POLAR_LIVE=1` + `POLAR_ACCESS_TOKEN`, `live-gate.ts`):
 *
 *   set -a; . .env.test.local; set +a
 *   POLAR_LIVE=1 npx jest checkout-tax-id.live --no-coverage --runInBand
 *
 * See this repo's own task notes for the run date/checkout ids this was last proven against — never
 * repeated here to avoid this header going stale next to a still-passing test.
 */
import { Polar } from '@polar-sh/sdk';

import prisma from '@/prisma/prisma.service';

import { createCheckoutSession } from './checkout-session';
import { liveDescribe } from '../documents/transports/live-gate';

const describeLive = liveDescribe('POLAR_LIVE', ['POLAR_ACCESS_TOKEN']);

describeLive('checkout-tax-id — real Polar sandbox round-trip', () => {
  const runId = Date.now();
  const client = new Polar({ accessToken: process.env.POLAR_ACCESS_TOKEN, server: 'sandbox' });
  const companyIds: string[] = [];

  afterAll(async () => {
    for (const companyId of companyIds) {
      await prisma.partyIdentifier.deleteMany({ where: { companyId } });
      await prisma.companySubscription.deleteMany({ where: { companyId } });
      await prisma.company.delete({ where: { id: companyId } }).catch(() => undefined);
    }
  });

  async function makeCompany(vatValue: string, suffix: string): Promise<string> {
    const company = await prisma.company.create({
      data: {
        name: `Sandbox tax-id co ${suffix} ${runId}`,
        foundedAt: new Date(),
        address: '12 Rue de la Paix',
        postalCode: '75002',
        city: 'Paris',
        phone: '',
        country: 'France',
        countryCode: 'FR',
        email: `billing+tax-id-proof-${suffix}-${runId}@invoicerr.app`,
      },
    });
    companyIds.push(company.id);
    await prisma.partyIdentifier.create({
      data: { companyId: company.id, scheme: 'VAT', value: vatValue },
    });
    return company.id;
  }

  async function readBackCheckout(
    companyId: string,
  ): Promise<Awaited<ReturnType<typeof client.checkouts.get>>> {
    const pages = await client.checkouts.list({ externalCustomerId: companyId, limit: 1 });
    for await (const page of pages) {
      const item = page.result.items[0];
      if (item) return item;
    }
    throw new Error(`Could not find a checkout for company ${companyId} via checkouts.list.`);
  }

  it('a bare SIREN (invalid VAT syntax) never reaches Polar — checkout created with no tax id, no retry needed', async () => {
    const companyId = await makeCompany('982187676', 'siren');

    const result = await createCheckoutSession({
      companyId,
      slug: 'monthly',
      successUrl: 'https://invoicerr.app/settings/billing?checkout=success',
      returnUrl: 'https://invoicerr.app/settings/billing',
    });

    if (result.taxIdRejected) {
      throw new Error('Expected no retry (nothing was ever sent to Polar) — hard failure.');
    }

    const stored = await readBackCheckout(companyId);
    if (stored.customerTaxId) {
      throw new Error(`Expected NO tax id stored — hard failure. Got: ${stored.customerTaxId}`);
    }

    console.log(`SIREN proof OK — checkout ${stored.id}, customerTaxId ${stored.customerTaxId}.`);
  }, 30_000);

  it('a checksum-valid FR VAT number reaches Polar; if Polar/VIES refuses it, the checkout still succeeds without it', async () => {
    const companyId = await makeCompany('FR54982187676', 'checksum-valid');

    const result = await createCheckoutSession({
      companyId,
      slug: 'monthly',
      successUrl: 'https://invoicerr.app/settings/billing?checkout=success',
      returnUrl: 'https://invoicerr.app/settings/billing',
    });

    const stored = await readBackCheckout(companyId);
    console.log(
      `Checksum-valid VAT proof — checkout ${stored.id}, taxIdRejected=${Boolean(result.taxIdRejected)}, ` +
        `stored customerTaxId=${stored.customerTaxId}.`,
    );

    if (result.taxIdRejected) {
      if (stored.customerTaxId) {
        throw new Error(
          `taxIdRejected=true but Polar still stored a tax id — hard failure. Got: ${stored.customerTaxId}`,
        );
      }
    } else if (stored.customerTaxId !== 'FR54982187676') {
      throw new Error(
        `Not reported as rejected, so expected the tax id to be stored — hard failure. Got: ${stored.customerTaxId}`,
      );
    }
  }, 30_000);
});
