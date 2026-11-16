/**
 * VAT on Invoicerr's own subscriptions (#760, #971 slice 9).
 *
 * Two modes, chosen by `BILLING_VAT` (read once at boot, refused when unknown):
 *
 * - `franchise` (default): the publisher is under the French VAT franchise. No VAT is charged and
 *   every subscription invoice carries the mention required by article 293 B of the CGI. The mention
 *   is set as the invoice footer of each company's Stripe customer when it is created, so the first
 *   invoice of a checkout already carries it, and on every draft subscription invoice Stripe sends
 *   (`invoice.created`), so a customer created before the mention existed gets it from its next one.
 * - `charge`: VAT is charged through Stripe Tax. Checkout turns on automatic tax, requires a billing
 *   address and offers to enter a VAT number. Stripe Tax applies French VAT (20%) to French customers
 *   and to EU consumers, and the reverse charge to an EU business whose VAT number it accepted; it
 *   then reports `reverse_charge` as the taxability reason of the invoice taxes. A draft invoice in
 *   that case gets the reverse charge mention (article 283-2 of the CGI, article 196 of directive
 *   2006/112/EC) as its footer; any other draft invoice gets no footer, so a franchise mention left on
 *   an older customer never reaches an invoice that charges VAT.
 *
 * Stripe Tax itself (head office address, French registration) is configured once in the Stripe
 * dashboard; the code only switches it on per checkout. Subscriptions created under the franchise
 * keep running without automatic tax after the switch to `charge`: moving them is an operator step.
 */
import type Stripe from 'stripe';

import { isBillingEnabled } from './billing-flag';

export type BillingVatMode = 'franchise' | 'charge';

const VAT_MODES = new Set<string>(['franchise', 'charge']);

export const VAT_FRANCHISE_MENTION = 'TVA non applicable, art. 293 B du CGI';
export const VAT_REVERSE_CHARGE_MENTION =
  'Autoliquidation : TVA due par le preneur, art. 283-2 du CGI et art. 196 de la directive 2006/112/CE';

const rawMode = (env: NodeJS.ProcessEnv): string => (env.BILLING_VAT ?? '').trim().toLowerCase();

export function findBillingVatProblems(env: NodeJS.ProcessEnv = process.env): string[] {
  const mode = rawMode(env);
  return mode === '' || VAT_MODES.has(mode)
    ? []
    : [`BILLING_VAT must be "franchise" or "charge", got "${mode}"`];
}

/** The VAT mode of the subscriptions. Unset means `franchise`; an unknown value throws. */
export function readBillingVatMode(env: NodeJS.ProcessEnv = process.env): BillingVatMode {
  const problems = findBillingVatProblems(env);
  if (problems.length > 0) throw new Error(`[billing] ${problems.join('; ')}`);
  return (rawMode(env) || 'franchise') as BillingVatMode;
}

export function assertBillingVatConfiguredForBoot(env: NodeJS.ProcessEnv = process.env): void {
  if (!isBillingEnabled(env)) return;
  const problems = findBillingVatProblems(env);
  if (problems.length > 0) {
    throw new Error(
      `[billing] Refusing to boot: the VAT configuration is invalid:\n- ${problems.join('\n- ')}\nSee .env.example.`,
    );
  }
}

/** What a company's Stripe customer is created with, on top of its name and email. */
export function vatCustomerCreateParams(mode: BillingVatMode): Partial<Stripe.CustomerCreateParams> {
  return mode === 'franchise' ? { invoice_settings: { footer: VAT_FRANCHISE_MENTION } } : {};
}

/** What a subscription checkout session is created with, on top of what the plugin sets. */
export function vatCheckoutSessionParams(mode: BillingVatMode): Stripe.Checkout.SessionCreateParams {
  if (mode === 'franchise') return {};
  return {
    automatic_tax: { enabled: true },
    billing_address_collection: 'required',
    tax_id_collection: { enabled: true },
    // Stripe refuses a VAT number collected on an existing customer unless Checkout may write the
    // name and address it was entered with back onto that customer.
    customer_update: { address: 'auto', name: 'auto' },
  };
}

/** The fields of a Stripe invoice the footer decision reads. */
export interface VatInvoice {
  id?: string;
  status?: string | null;
  footer?: string | null;
  total_taxes?: Array<{ taxability_reason?: string | null }> | null;
}

const isReverseCharge = (invoice: VatInvoice): boolean =>
  (invoice.total_taxes ?? []).some((tax) => tax.taxability_reason === 'reverse_charge');

/** The footer an invoice must carry in this mode. */
export function vatFooterFor(mode: BillingVatMode, invoice: VatInvoice): string {
  if (mode === 'franchise') return VAT_FRANCHISE_MENTION;
  return isReverseCharge(invoice) ? VAT_REVERSE_CHARGE_MENTION : '';
}

/** The footer to write on a freshly created invoice, or null when there is nothing to change: the
 *  invoice is no longer a draft (Stripe refuses the edit) or already carries the right footer. */
export function vatFooterUpdate(mode: BillingVatMode, invoice: VatInvoice): string | null {
  if (invoice.status !== 'draft') return null;
  const footer = vatFooterFor(mode, invoice);
  return (invoice.footer ?? '') === footer ? null : footer;
}

export interface VatWebhookEvent {
  type: string;
  data: { object: unknown };
}

export type UpdateInvoiceFooter = (invoiceId: string, footer: string) => Promise<unknown>;

/**
 * Puts the VAT mention of `mode` on a draft invoice Stripe just created. Any other event is ignored.
 * A failed write throws, so Stripe retries the event while the invoice is still a draft.
 */
export async function applyVatMentionToInvoiceEvent(
  event: VatWebhookEvent,
  mode: BillingVatMode,
  updateFooter: UpdateInvoiceFooter,
): Promise<void> {
  if (event.type !== 'invoice.created') return;
  const invoice = event.data.object as VatInvoice;
  if (!invoice.id) return;
  const footer = vatFooterUpdate(mode, invoice);
  if (footer === null) return;
  await updateFooter(invoice.id, footer);
}
