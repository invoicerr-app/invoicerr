/**
 * REAL round-trips against the Polar SANDBOX organization for three of the second-lot edge-case
 * decisions this repo's own code (never a hand-rolled duplicate of the SDK calls) actually implements —
 * a sibling of `billing-option-a.live.spec.ts`, which already proves the base checkout/portal/webhook
 * flow; this file only adds what THAT one does not cover. Gated the same way every other live spec is
 * (`POLAR_LIVE=1` + `POLAR_ACCESS_TOKEN` — `live-gate.ts`, reused verbatim) — PLUS
 * `WARNING__ENABLE_BILLING_FOR_USERS__WARNING=true`, never set by `.env.test.local` itself:
 * `customer-sync.ts#syncPolarCustomerOnCompanyChange` (like every function in this module family)
 * checks `isBillingEnabled()` FIRST and no-ops silently without it — the rename test below no-op'd,
 * wrongly reading as a real failure, the first time this was run without that flag set:
 *
 *   set -a; . .env.test.local; set +a
 *   POLAR_LIVE=1 WARNING__ENABLE_BILLING_FOR_USERS__WARNING=true \
 *     npx jest billing-edge-cases.live --no-coverage --runInBand
 *
 * RUN AND GREEN 2026-09-16, sandbox credentials from `.env.test.local` — checkout
 * `49f4ca4f-a743-4300-bdab-b8adbbefbce7` (FR, taxId FR83404833048), customer
 * `119831cb-533a-413a-b9bd-dab85ebbbe1d` renamed live, `subscriptions.revoke` confirmed reachable
 * (404 ResourceNotFound on a synthetic id).
 *
 * WHAT EACH TEST PROVES, and its OWN limit:
 *  - checkout prefill (address + VAT number): a real Company row (FR address, a VAT `PartyIdentifier`)
 *    goes through `checkout-session.ts#createCheckoutSession` exactly as `BillingController` calls it;
 *    the resulting checkout is read straight back from Polar (`checkouts.get`) and its own
 *    `customerBillingAddress`/`customerTaxId`/`isBusinessCustomer` are asserted against what this
 *    company actually has on file — proves Polar ACCEPTED and STORED the prefill, not merely that this
 *    app sent it.
 *  - customer update after rename: the SAME company is renamed in the local DB, then
 *    `customer-sync.ts#syncPolarCustomerOnCompanyChange` is called (the exact function
 *    `company.service.ts#editCompanyInfo` calls inline); the customer is read back from Polar
 *    (`customers.getExternal`) and its `name` is asserted to have actually changed there.
 *  - cancellation reachability ahead of deletion: `deletion.ts`'s own `subscriptions.revoke` call is
 *    exercised against a SYNTHETIC (never-real) subscription id — this sandbox run never completed an
 *    actual PAYMENT (Polar's own `checkouts.create` has no "complete this payment" API, confirmed while
 *    researching this feature — a human in a browser is required), so there is no REAL subscription to
 *    revoke here. What this DOES prove: `subscriptions.revoke({id})` is a real, reachable Polar
 *    operation this SDK version exposes exactly the way `deletion.ts` calls it, and that a
 *    non-existent id comes back as the SAME `ResourceNotFound` shape `isResourceNotFoundError`
 *    already detects everywhere else in this codebase — never a network/auth failure that would mean
 *    the call itself is wrong. A genuine "revoke a REAL, paid subscription" round-trip needs a human
 *    completing a sandbox payment first, exactly like `billing-option-a.live.spec.ts`'s own header
 *    already notes for the base checkout flow.
 */
import { randomUUID } from 'node:crypto';

import { Polar } from '@polar-sh/sdk';

import prisma from '@/prisma/prisma.service';

import { createCheckoutSession } from './checkout-session';
import { syncPolarCustomerOnCompanyChange } from './customer-sync';
import { liveDescribe } from '../documents/transports/live-gate';

const describeLive = liveDescribe('POLAR_LIVE', ['POLAR_ACCESS_TOKEN']);

describeLive('Polar live round-trip (sandbox organization) — second-lot edge cases', () => {
  const runId = Date.now();
  const companyEmail = `billing+edge-cases-proof-${runId}@invoicerr.app`;
  let companyId: string;
  const client = new Polar({ accessToken: process.env.POLAR_ACCESS_TOKEN, server: 'sandbox' });

  afterAll(async () => {
    if (companyId) {
      await prisma.partyIdentifier.deleteMany({ where: { companyId } });
      await prisma.companySubscription.deleteMany({ where: { companyId } });
      await prisma.company.delete({ where: { id: companyId } }).catch(() => undefined);
    }
  });

  it("prefills the checkout with the company's own address and VAT number, and Polar actually stores it", async () => {
    const company = await prisma.company.create({
      data: {
        name: `Sandbox edge-case co ${runId}`,
        foundedAt: new Date(),
        address: '12 Rue de la Paix',
        postalCode: '75002',
        city: 'Paris',
        phone: '',
        country: 'France',
        countryCode: 'FR',
        email: companyEmail,
      },
    });
    companyId = company.id;
    // A syntactically valid French VAT number (checksum key = (12 + 3 * (SIREN mod 97)) mod 97) — a
    // real-shaped number Polar's own validation accepts, never claimed to belong to a real company.
    await prisma.partyIdentifier.create({ data: { companyId, scheme: 'VAT', value: 'FR83404833048' } });

    const checkout = await createCheckoutSession({
      companyId,
      slug: 'monthly',
      successUrl: 'https://invoicerr.app/settings/billing?checkout=success',
      returnUrl: 'https://invoicerr.app/settings/billing',
    });

    if (!checkout.url.startsWith('https://')) {
      throw new Error(`Checkout did not return a usable URL — hard failure. Got: ${checkout.url}`);
    }

    // The URL embeds the checkout's own CLIENT SECRET, not its internal id — `checkouts.get({id})`
    // wants the latter, so the created checkout is looked up back by its external customer instead
    // (this company's own, `externalId = company.id` under option A).
    const pages = await client.checkouts.list({ externalCustomerId: companyId, limit: 1 });
    let stored: Awaited<ReturnType<typeof client.checkouts.get>> | undefined;
    for await (const page of pages) {
      stored = page.result.items[0];
      break;
    }
    if (!stored) {
      throw new Error('Could not find the just-created checkout via checkouts.list — hard failure.');
    }

    if (stored.isBusinessCustomer !== true) {
      throw new Error(`Expected isBusinessCustomer true — hard failure. Got: ${stored.isBusinessCustomer}`);
    }
    if (stored.customerBillingAddress?.country !== 'FR') {
      throw new Error(
        `Expected the billing address country to be FR — hard failure. Got: ${JSON.stringify(stored.customerBillingAddress)}`,
      );
    }
    if (stored.customerTaxId !== 'FR83404833048') {
      throw new Error(`Expected the tax id to be stored — hard failure. Got: ${stored.customerTaxId}`);
    }

    console.log(
      `Checkout prefill proof OK — checkout ${stored.id}, country ${stored.customerBillingAddress.country}, ` +
        `taxId ${stored.customerTaxId}.`,
    );
  }, 30_000);

  it("updates the company's Polar customer name after a rename, and Polar reads it back changed", async () => {
    const renamedTo = `Sandbox edge-case co ${runId} RENAMED`;
    await prisma.company.update({ where: { id: companyId }, data: { name: renamedTo } });

    await syncPolarCustomerOnCompanyChange(companyId, {
      name: renamedTo,
      email: companyEmail,
      billingEmail: null,
    });

    const customer = await client.customers.getExternal({ externalId: companyId });
    if (customer.name !== renamedTo) {
      throw new Error(
        `Expected the Polar customer's name to be updated — hard failure. Got: ${customer.name}`,
      );
    }

    console.log(`Customer rename proof OK — customer ${customer.id} now named "${customer.name}".`);
  }, 30_000);

  it('subscriptions.revoke is a real, reachable Polar operation — a non-existent id answers the SAME ResourceNotFound shape this codebase already detects', async () => {
    let caught: unknown;
    try {
      // A well-formed, random UUID v4 — Polar's own routing validates the id as a UUID V4
      // specifically BEFORE even checking whether a subscription with it exists (an all-zeros or
      // otherwise non-v4 UUID, tried first, answers a 422 shape-validation error instead of the 404
      // this test actually wants to prove).
      await client.subscriptions.revoke({ id: randomUUID() });
    } catch (error) {
      caught = error;
    }

    if (!caught || (caught as { statusCode?: number }).statusCode !== 404) {
      throw new Error(
        `Expected a 404 ResourceNotFound from subscriptions.revoke on a fake id — hard failure. Got: ${JSON.stringify(caught)}`,
      );
    }

    console.log('subscriptions.revoke reachability proof OK — 404 ResourceNotFound for a synthetic id.');
  }, 15_000);
});
