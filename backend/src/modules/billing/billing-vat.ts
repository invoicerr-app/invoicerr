/**
 * VAT on Invoicerr's own subscriptions (#760, #971 slice 9).
 *
 * Two modes, chosen by `BILLING_VAT` (read once at boot, refused when unknown):
 *
 * - `franchise` (default): the publisher is under the French VAT franchise. No VAT is charged and
 *   every subscription invoice carries the mention required by article 293 B of the CGI.
 * - `charge`: VAT is charged through Stripe Tax. French VAT (20%) applies, except the reverse charge
 *   for a company established in another EU member state whose VAT number Invoicerr validated
 *   (`PartyIdentifier` scheme `VAT`, `validationStatus` `VALID`, from VIES). Such an invoice carries
 *   the reverse charge mention (article 283-2 of the CGI, article 196 of directive 2006/112/EC).
 *
 * The first invoice of a checkout is finalized by Stripe the moment the subscription starts, so it
 * cannot be edited afterwards. Its mention therefore comes from the company's Stripe customer, synced
 * from the company record right before the checkout session is created (`syncCustomerForCheckout`):
 * the invoice footer (the mention of the mode, or none), the billing address, and the EU VAT number
 * only when it gives the reverse charge. Checkout then neither collects a VAT number nor rewrites the
 * address, so Stripe Tax and the footer decide from the same data. Renewals are also covered by the
 * `invoice.created` webhook, which sets the footer of each draft invoice from the taxes Stripe Tax
 * actually applied.
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
    // The address and VAT number are the company's, synced onto the customer before checkout
    // (`syncCustomerForCheckout`); Checkout must not replace them, or the footer of the first invoice
    // could disagree with the tax Stripe applies.
    customer_update: { address: 'never', name: 'never' },
  };
}

/** EU member states (ISO 3166-1 alpha-2). Greece is `GR` here; Stripe and VIES prefixes say `EL`. */
const EU_MEMBER_STATES = new Set([
  'AT',
  'BE',
  'BG',
  'CY',
  'CZ',
  'DE',
  'DK',
  'EE',
  'ES',
  'FI',
  'FR',
  'GR',
  'HR',
  'HU',
  'IE',
  'IT',
  'LT',
  'LU',
  'LV',
  'MT',
  'NL',
  'PL',
  'PT',
  'RO',
  'SE',
  'SI',
  'SK',
]);
const PUBLISHER_COUNTRY = 'FR';

/** What the tax of a company's subscription is decided from: its own record in Invoicerr. */
export interface CompanyTaxProfile {
  address: {
    line1: string;
    line2?: string | null;
    postalCode: string;
    city: string;
    state?: string | null;
    countryCode: string | null;
  };
  /** The company's VAT number and whether Invoicerr validated it (VIES). */
  vat: { value: string; validationStatus: string | null } | null;
}

export type FindCompanyTaxProfile = (companyId: string) => Promise<CompanyTaxProfile | null>;

const countryOf = (profile: CompanyTaxProfile): string =>
  (profile.address.countryCode ?? '').trim().toUpperCase();

/** The reverse charge applies to a company established in another EU member state with a VAT number
 *  Invoicerr validated. */
export function isReverseChargeCompany(profile: CompanyTaxProfile): boolean {
  const country = countryOf(profile);
  return (
    country !== PUBLISHER_COUNTRY &&
    EU_MEMBER_STATES.has(country) &&
    profile.vat !== null &&
    profile.vat.value.trim() !== '' &&
    profile.vat.validationStatus === 'VALID'
  );
}

/** The footer every invoice of this customer starts with, the first one included. */
export function customerVatFooter(mode: BillingVatMode, profile: CompanyTaxProfile | null): string {
  if (mode === 'franchise') return VAT_FRANCHISE_MENTION;
  return profile !== null && isReverseChargeCompany(profile) ? VAT_REVERSE_CHARGE_MENTION : '';
}

/** A VAT number as Stripe's `eu_vat` type wants it: country prefix included, no spaces. */
export function stripeEuVatValue(profile: CompanyTaxProfile): string {
  const raw = (profile.vat?.value ?? '').replace(/[\s.-]/g, '').toUpperCase();
  const prefix = countryOf(profile) === 'GR' ? 'EL' : countryOf(profile);
  return /^[A-Z]{2}/.test(raw) ? raw : `${prefix}${raw}`;
}

/** The Stripe calls syncing a customer needs. */
export interface CustomerVatClient {
  updateCustomer: (customerId: string, params: Stripe.CustomerUpdateParams) => Promise<unknown>;
  listTaxIds: (customerId: string) => Promise<Array<{ id: string; type: string; value: string }>>;
  createTaxId: (customerId: string, params: { type: 'eu_vat'; value: string }) => Promise<unknown>;
  deleteTaxId: (customerId: string, taxId: string) => Promise<unknown>;
}

/**
 * Brings the company's Stripe customer in line with its record before a checkout session is created,
 * so the first invoice, finalized at once, already carries the right mention. Under the franchise only
 * the footer is written. With VAT charged: the address, the footer, and the `eu_vat` tax id exactly
 * when the company gets the reverse charge (any other `eu_vat` id is removed, so Stripe Tax cannot
 * reverse charge an invoice whose footer says nothing). A failed call throws: no checkout opens on a
 * customer whose mention is not set.
 */
export async function syncCustomerForCheckout(
  mode: BillingVatMode,
  customerId: string,
  profile: CompanyTaxProfile | null,
  client: CustomerVatClient,
): Promise<void> {
  const footer = customerVatFooter(mode, profile);
  if (mode === 'franchise' || profile === null) {
    await client.updateCustomer(customerId, { invoice_settings: { footer } });
    return;
  }
  const { address } = profile;
  await client.updateCustomer(customerId, {
    invoice_settings: { footer },
    address: {
      line1: address.line1,
      line2: address.line2 ?? undefined,
      postal_code: address.postalCode,
      city: address.city,
      state: address.state ?? undefined,
      country: countryOf(profile) || undefined,
    },
  });
  const wanted = isReverseChargeCompany(profile) ? stripeEuVatValue(profile) : null;
  const euVatIds = (await client.listTaxIds(customerId)).filter((taxId) => taxId.type === 'eu_vat');
  for (const taxId of euVatIds) {
    if (taxId.value.toUpperCase() !== wanted) await client.deleteTaxId(customerId, taxId.id);
  }
  if (wanted !== null && !euVatIds.some((taxId) => taxId.value.toUpperCase() === wanted)) {
    await client.createTaxId(customerId, { type: 'eu_vat', value: wanted });
  }
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
