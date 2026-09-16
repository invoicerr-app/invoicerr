/**
 * `Company.billingEmail` read/write — its OWN small seam (like `iban`'s own dedicated write path,
 * `schema.prisma`'s own comment on that column), not folded into `company.service.ts#editCompanyInfo`
 * /`EditCompanyDto`: this field is meaningless outside hosted billing, so it belongs in the
 * billing module (flag-gated, `billing.controller.ts`'s own `PUT /billing/billing-email`) rather than
 * the always-registered company-info endpoint.
 *
 * Never talks to Polar itself — a duplicate-email refusal can only be discovered at CHECKOUT time
 * (`billing-customer.ts`'s own `BillingEmailTakenError`), once Polar is actually asked to create the
 * customer; saving this field alone is a plain, always-successful local write.
 */
import prisma from '@/prisma/prisma.service';

import { syncPolarCustomerOnCompanyChange } from './customer-sync';

export interface BillingEmailView {
  /** The raw override, or `null` when the company has never set one (falls back to its own contact
   *  `email` — see `billing-customer.ts#resolveBillingEmail`). */
  billingEmail: string | null;
  /** The company's own contact email, shown alongside so the settings screen can display "currently
   *  billing under: X" without a second query. */
  companyEmail: string;
}

export async function getCompanyBillingEmail(companyId: string): Promise<BillingEmailView> {
  const company = await prisma.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { email: true, billingEmail: true },
  });
  return { billingEmail: company.billingEmail, companyEmail: company.email };
}

/** `billingEmail: null` (or an all-whitespace string) clears the override back to "use the company's
 *  own contact email" — never stored as an empty string, so `resolveBillingEmail`'s own
 *  `override ? override : company.email` fallback stays the single place this decision is made. */
export async function setCompanyBillingEmail(
  companyId: string,
  billingEmail: string | null,
): Promise<BillingEmailView> {
  const trimmed = billingEmail?.trim();
  const company = await prisma.company.update({
    where: { id: companyId },
    data: { billingEmail: trimmed ? trimmed : null },
    select: { name: true, email: true, billingEmail: true },
  });

  // The resolved billing email (this override, once set, wins over the plain contact email — see
  // `resolveBillingEmail`'s own header) is exactly what a company's Polar CUSTOMER should show —
  // pushed here too, not only from `editCompanyInfo`, since this is its own separate write path (this
  // file's own header on why). Best-effort, never blocks this write — see `customer-sync.ts`.
  await syncPolarCustomerOnCompanyChange(companyId, company);

  return { billingEmail: company.billingEmail, companyEmail: company.email };
}
