import Stripe from 'stripe';

/** A Stripe API client from `STRIPE_SECRET_KEY`. One per environment object: the plugin and the
 *  deletion paths share it in production, a spec passing its own `env` gets its own. */
const clients = new WeakMap<NodeJS.ProcessEnv, Stripe>();

export function stripeClientFor(env: NodeJS.ProcessEnv = process.env): Stripe {
  let client = clients.get(env);
  if (!client) {
    client = new Stripe((env.STRIPE_SECRET_KEY ?? '').trim());
    clients.set(env, client);
  }
  return client;
}
