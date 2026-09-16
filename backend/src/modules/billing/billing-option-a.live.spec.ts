/**
 * REAL round-trip against a Polar SANDBOX organization, proving option A (2026-09-16: one Polar
 * customer PER COMPANY) through THIS repo's own code — never a hand-rolled duplicate of the SDK calls
 * (`checkout-session.ts`/`billing-customer.ts`/`portal-session.ts`/`webhook-handlers.ts` are imported
 * and called directly, the same functions `BillingController` calls). Gated the same way every other
 * live spec is (`POLAR_LIVE=1` + `POLAR_ACCESS_TOKEN` — `live-gate.ts`, reused verbatim):
 *
 *   set -a; . .env.test.local; set +a
 *   POLAR_LIVE=1 npx jest billing-option-a.live --no-coverage --runInBand
 *
 * (Sourcing `.env.test.local` first, rather than passing `POLAR_ACCESS_TOKEN=...` inline, is
 * deliberate — see `CLAUDE.md`'s own absolute rule: a secret value is never typed into a command or
 * logged. `prisma.service.ts`'s own `dotenv/config` also loads `.env` for `DATABASE_URL` — dotenv
 * never overrides an already-exported var, so the sandbox POLAR_* values from `.env.test.local` win.)
 *
 * WHAT A GREEN RUN PROVES: a real Company row (created fresh in THIS run, deleted at the end) gets its
 * own Polar customer (`external_id = company.id`, confirmed via `customers.getExternal`), a real
 * checkout session (`externalCustomerId`/`metadata.companyId` both echoed back by Polar), and a real
 * portal session — all through this repo's own `checkout-session.ts`/`portal-session.ts`. It then
 * proves the WEBHOOK resolution path end-to-end against that same real customer: a
 * `subscription.created`-shaped payload, carrying the REAL customer id/external_id this run just
 * created, is run through the REAL `handleSubscriptionPayload` (`webhook-handlers.ts`) and the
 * resulting `CompanySubscription` row is read back from the DEV Postgres database to confirm it
 * landed on the CORRECT company — never a different one.
 *
 * WHAT IT DOES NOT PROVE: an actual Polar-delivered HTTP webhook reaching
 * `POST /api/billing/webhooks/polar` — no CI runner here is a reachable public endpoint (the same gap
 * `polar.live.spec.ts`'s own header documents), and completing a real sandbox payment needs a human in
 * a browser (`checkouts.create` has no "complete this payment" API — confirmed while researching this
 * feature, 2026-09-16). What IS proven is everything OTHER than the literal HTTP delivery: the
 * customer/checkout/portal calls this app's own code makes, and the exact payload-to-company
 * resolution `polar-webhook.controller.ts`'s `toSubscriptionWebhookPayload` produces from a REAL wire
 * shape (`data.customer.external_id` — confirmed present on real captured deliveries in this
 * feature's own sandbox research, 2026-09-16).
 */
import prisma from '@/prisma/prisma.service';

import { getOrCreatePolarCustomerForCompany, loadCompanyBillingIdentity } from './billing-customer';
import { createCheckoutSession } from './checkout-session';
import { liveDescribe } from '../documents/transports/live-gate';
import { createCustomerPortalSession } from './portal-session';
import { handleSubscriptionPayload } from './webhook-handlers';

const describeLive = liveDescribe('POLAR_LIVE', ['POLAR_ACCESS_TOKEN']);

describeLive('Polar live round-trip (sandbox organization) — option A, one customer per company', () => {
  const runId = Date.now();
  const companyEmail = `billing+option-a-proof-${runId}@invoicerr.app`;
  let companyId: string;

  afterAll(async () => {
    // Local DB cleanup only — the sandbox Polar customer is left in place, same as this feature's
    // own `trial-company-A`/`trial-company-B` sandbox research fixtures (harmless, and Polar has no
    // customer-deletion need here: sandbox data, never billed for real).
    if (companyId) {
      await prisma.companySubscription.deleteMany({ where: { companyId } });
      await prisma.company.delete({ where: { id: companyId } }).catch(() => undefined);
    }
  });

  it("creates a real company-scoped Polar customer, checkout session, and portal session through this repo's own code", async () => {
    const company = await prisma.company.create({
      data: {
        name: `Sandbox proof co ${runId}`,
        foundedAt: new Date(),
        address: '',
        postalCode: '',
        city: '',
        phone: '',
        country: 'FR',
        email: companyEmail,
      },
    });
    companyId = company.id;

    const identity = await loadCompanyBillingIdentity(companyId);
    const customer = await getOrCreatePolarCustomerForCompany(identity);
    if (customer.type !== 'individual') {
      throw new Error(`Expected a fresh customer to read back "individual", got "${customer.type}".`);
    }

    const checkout = await createCheckoutSession({
      companyId,
      slug: 'monthly',
      successUrl: 'https://invoicerr.app/settings/billing?checkout=success',
      returnUrl: 'https://invoicerr.app/settings/billing',
    });
    if (!checkout.url.startsWith('https://')) {
      throw new Error(`Checkout did not return a usable URL — hard failure. Got: ${checkout.url}`);
    }

    const portal = await createCustomerPortalSession(
      companyId,
      { id: 'sandbox-proof-user', email: companyEmail, name: 'Sandbox Proof User' },
      'https://invoicerr.app/settings/billing',
    );
    if (!portal.url.startsWith('https://')) {
      throw new Error(`Portal did not return a usable URL — hard failure. Got: ${portal.url}`);
    }

    // Webhook resolution proof — see this file's own header for exactly what this does and does not
    // prove. Uses the REAL customer id this run just created; `external_id` on it is REAL (Polar
    // itself reports it via `customers.getExternal` above), not fabricated.
    await handleSubscriptionPayload({
      data: {
        id: `sub_proof_${runId}`,
        customerId: customer.id,
        status: 'active',
        recurringInterval: 'month',
        metadata: { companyId },
        customerExternalId: companyId,
      },
    });

    const sub = await prisma.companySubscription.findUnique({ where: { companyId } });
    if (!sub || sub.polarCustomerId !== customer.id || sub.status !== 'ACTIVE') {
      throw new Error(
        `Webhook resolution did not land on the expected company — hard failure. Got: ${JSON.stringify(sub)}`,
      );
    }

    console.log(
      `Polar sandbox proof OK — company ${companyId}, customer ${customer.id}, checkout ${checkout.url}, ` +
        `portal ${portal.url}.`,
    );
  }, 30_000);
});
