/**
 * REAL check against the Polar SANDBOX organization: does EITHER configured product
 * (`POLAR_PRODUCT_ID_MONTHLY`/`POLAR_PRODUCT_ID_YEARLY`) carry a Polar-SIDE trial
 * (`Product.trialInterval`/`trialIntervalCount`, `@polar-sh/sdk`'s own
 * `node_modules/@polar-sh/sdk/dist/commonjs/models/components/product.d.ts`, read directly)?
 *
 * Product decision: this app's OWN 14-day trial (`lifecycle.ts#TRIAL_DAYS`) is the only trial that is
 * supposed to exist — it is tracked entirely in `CompanySubscription` and never depends on Polar
 * knowing about a trial at all. If Polar's own product configuration ALSO carries a trial, a company
 * would get 14 days from this app PLUS whatever Polar's own trial grants on top once it checks out —
 * a real double-trial bug this spec exists to catch before it reaches a paying customer, not something
 * a mocked test could ever prove (mocking `products.get` would just assert whatever the mock was told
 * to return).
 *
 * Gated the same way every other live spec is (`POLAR_LIVE=1` + `POLAR_ACCESS_TOKEN` — `live-gate.ts`,
 * reused verbatim). HARD FAILS (never a soft warning) if a trial is found on either product — per the
 * product decision (`polar-edge-cases-brief.md`'s own §15 as relayed by the owner): "sinon, le
 * documenter et retirer l'un des deux" — a failure here means the SANDBOX product configuration itself
 * needs fixing in Polar's own dashboard, not this code.
 *
 *   set -a; . .env.test.local; set +a
 *   POLAR_LIVE=1 POLAR_PRODUCT_ID_MONTHLY=... POLAR_PRODUCT_ID_YEARLY=... \
 *     npx jest polar-trial-config.live --no-coverage --runInBand
 */
import { Polar } from '@polar-sh/sdk';

import { liveDescribe } from '../documents/transports/live-gate';

const describeLive = liveDescribe('POLAR_LIVE', ['POLAR_ACCESS_TOKEN']);

describeLive(
  'Polar live check (sandbox organization) — no Polar-side trial on either configured product',
  () => {
    const monthlyId = process.env.POLAR_PRODUCT_ID_MONTHLY;
    const yearlyId = process.env.POLAR_PRODUCT_ID_YEARLY;

    it("neither POLAR_PRODUCT_ID_MONTHLY nor POLAR_PRODUCT_ID_YEARLY carries its own Polar-side trial — this app's 14-day trial is the only one", async () => {
      if (!monthlyId || !yearlyId) {
        throw new Error(
          'POLAR_PRODUCT_ID_MONTHLY/POLAR_PRODUCT_ID_YEARLY must both be set to run this check against ' +
            'the real sandbox products.',
        );
      }

      const client = new Polar({ accessToken: process.env.POLAR_ACCESS_TOKEN, server: 'sandbox' });

      const [monthly, yearly] = await Promise.all([
        client.products.get({ id: monthlyId }),
        client.products.get({ id: yearlyId }),
      ]);

      const offenders: string[] = [];
      for (const [label, product] of [
        ['monthly', monthly],
        ['yearly', yearly],
      ] as const) {
        if (product.trialInterval !== null || (product.trialIntervalCount ?? 0) > 0) {
          offenders.push(
            `${label} (${product.id}): trialInterval=${product.trialInterval}, ` +
              `trialIntervalCount=${product.trialIntervalCount}`,
          );
        }
      }

      if (offenders.length > 0) {
        throw new Error(
          'DOUBLE-TRIAL RISK: the following Polar product(s) carry their OWN trial on top of this ' +
            "app's 14-day trial — remove the Polar-side trial in the dashboard for: " +
            offenders.join('; '),
        );
      }

      console.log(
        `Polar sandbox check OK — neither product (monthly ${monthly.id}, yearly ${yearly.id}) ` +
          'configures its own trial.',
      );
    }, 15_000);
  },
);
