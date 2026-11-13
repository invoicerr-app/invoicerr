/**
 * `Company.billingEmail` lives in the billing module, not in `editCompanyInfo`, because it is
 * meaningless outside hosted billing. Duplicate-email conflicts only surface at checkout time.
 */
import prisma from '@/prisma/prisma.service';

import { syncPolarCustomerOnCompanyChange } from './customer-sync';

export interface BillingEmailView {
  /** `null` means no override; billing falls back to the company contact email. */
  billingEmail: string | null;
  companyEmail: string;
}

export async function getCompanyBillingEmail(companyId: string): Promise<BillingEmailView> {
  const company = await prisma.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { email: true, billingEmail: true },
  });
  return { billingEmail: company.billingEmail, companyEmail: company.email };
}

/** Blank input is stored as `null`, never `''`, so `resolveBillingEmail` stays the only fallback logic. */
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

  // This is a separate write path from `editCompanyInfo`, so the Polar customer must be synced here too.
  await syncPolarCustomerOnCompanyChange(companyId, company);

  return { billingEmail: company.billingEmail, companyEmail: company.email };
}
