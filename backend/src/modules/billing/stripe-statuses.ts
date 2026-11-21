// Stripe subscription statuses, as stored by the better-auth Stripe plugin on `subscription.status`.

// Statuses Stripe can still charge, or move back to charging.
export const LIVE_STRIPE_STATUSES = ['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused'];

// Final statuses: Stripe will never bill these again.
export const ENDED_STRIPE_STATUSES = new Set(['canceled', 'incomplete_expired']);

// Statuses that count as paid for the company subscription.
export const PAID_STRIPE_STATUSES = new Set(['active', 'trialing']);
