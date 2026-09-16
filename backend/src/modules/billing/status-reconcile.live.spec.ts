/**
 * REAL round-trip against a Polar SANDBOX organization, proving the 2026-09-16 fix
 * (`status-reconcile.ts`'s own header, "An ACTIVE row is no longer trusted blindly") against the EXACT
 * shape of the reported incident: a company with its OWN, company-scoped Polar customer (created fresh
 * by this run — never subscribed) whose LOCAL `CompanySubscription` row is force-set to `ACTIVE` —
 * simulating the stale row a deleted pre-migration customer left behind — then run through the REAL,
 * exported `reconcileFromPolarIfStale` against a REAL Polar client. Same pattern as
 * `billing-option-a.live.spec.ts` (fresh Company row, cleaned up in `afterAll`, no mocks anywhere).
 *
 *   set -a; . .env.test.local; set +a
 *   POLAR_LIVE=1 npx jest status-reconcile.live --no-coverage --runInBand
 *
 * WHAT A GREEN RUN PROVES: `reconcileFromPolarIfStale` genuinely calls Polar
 * (`subscriptions.list({ externalCustomerId: companyId })`), finds nothing (a real customer with zero
 * subscriptions — exactly the reported incident, not a fabricated response), and never returns the row
 * as `ACTIVE` — the silent-stale-forever bug this fix closes. It also proves the downgrade actually
 * clears `interval` (`company-subscription.store.ts#recomputeStatusForVanishedSubscription`).
 *
 * WHAT IT DOES NOT PROVE: the ORIGINAL incident's own exact cause (a customer deleted by hand in
 * Polar's dashboard) — that would need a second sandbox customer created and then deleted through
 * Polar's own UI, a manual step outside a CI-runnable spec. What this DOES prove is the repair path
 * itself: given a company-scoped customer with no subscription (the state such a deletion leaves the
 * COMPANY's own customer in — never touched by that deletion, since it is a DIFFERENT customer), the
 * row is no longer left `ACTIVE` forever.
 */
import prisma from '@/prisma/prisma.service';

import { getOrCreatePolarCustomerForCompany, loadCompanyBillingIdentity } from './billing-customer';
import { liveDescribe } from '../documents/transports/live-gate';
import { reconcileFromPolarIfStale } from './status-reconcile';

const describeLive = liveDescribe('POLAR_LIVE', ['POLAR_ACCESS_TOKEN']);

describeLive(
  'Polar live round-trip (sandbox organization) — status-reconcile repairs a stale ACTIVE row',
  () => {
    const runId = Date.now();
    const companyEmail = `billing+status-reconcile-proof-${runId}@invoicerr.app`;
    let companyId: string;

    afterAll(async () => {
      // Local DB cleanup only — the sandbox Polar customer is left in place, same as
      // `billing-option-a.live.spec.ts`'s own cleanup (harmless: sandbox data, never billed for real).
      if (companyId) {
        await prisma.companySubscription.deleteMany({ where: { companyId } });
        await prisma.company.delete({ where: { id: companyId } }).catch(() => undefined);
      }
    });

    it('recomputes away from ACTIVE when the company-scoped customer has no subscription at all', async () => {
      const company = await prisma.company.create({
        data: {
          name: `Sandbox reconcile proof co ${runId}`,
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

      // Force the EXACT stale state the reported incident left behind: a row claiming ACTIVE, pointed
      // at ITS OWN real customer (never a fabricated id), which Polar itself confirms has no
      // subscription at all. `trialEndsAt` long over so the recompute lands on PAST_DUE/BLOCKED, never
      // reverting to TRIAL (`lifecycle.ts#computeRecoveredStatus`).
      const staleSub = await prisma.companySubscription.create({
        data: {
          companyId,
          status: 'ACTIVE',
          trialStartedAt: new Date(Date.now() - 74 * 24 * 60 * 60 * 1000),
          trialEndsAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
          polarCustomerId: customer.id,
          interval: 'YEAR',
        },
      });

      const reconciled = await reconcileFromPolarIfStale(staleSub, undefined, Date.now());

      if (reconciled.status === 'ACTIVE') {
        throw new Error(
          'reconcileFromPolarIfStale left the row ACTIVE despite the company-scoped customer having ' +
            `no subscription at all — hard failure. company=${companyId} customer=${customer.id}`,
        );
      }
      if (reconciled.interval !== null) {
        throw new Error(`Expected interval to be cleared on downgrade, got "${reconciled.interval}".`);
      }

      console.log(
        `Polar sandbox reconcile proof OK — company ${companyId}, customer ${customer.id}: ` +
          `ACTIVE -> ${reconciled.status} (blockedAt=${reconciled.blockedAt ?? 'null'}, ` +
          `interval=${reconciled.interval ?? 'null'}).`,
      );
    }, 30_000);
  },
);
