import Stripe from 'stripe';

import { stripeSecretKey } from './stripe-env';

/** A Stripe API client from `STRIPE_SECRET_KEY`. One per environment object: the plugin and the
 *  deletion paths share it in production, a spec passing its own `env` gets its own. */
const clients = new WeakMap<NodeJS.ProcessEnv, Stripe>();

export function stripeClientFor(env: NodeJS.ProcessEnv = process.env): Stripe {
  let client = clients.get(env);
  if (!client) {
    client = new Stripe(stripeSecretKey(env));
    clients.set(env, client);
  }
  return client;
}
