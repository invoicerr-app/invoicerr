import prisma from '@/prisma/prisma.service';

/**
 * The one place invoice-actions.ts reads WHICH transport a company chose — a single column on
 * Company (`invoiceTransportId`), read the same tenant-scoped way persistence.ts reads a
 * DocumentInstance. Deliberately its own tiny function (mockable with `jest.mock`, the same
 * discipline persistence.ts already gets) rather than inlined into the action handler: this is the
 * ONE line that would need to change if the choice ever moved to a richer shape (e.g. per-transport
 * config), and nothing else in invoice-actions.ts should need to know that.
 *
 * Null (not undefined, not throwing) means "not configured" — a perfectly normal state for a company
 * that has never set one, which is exactly the state invoice-actions.ts's "send" blocks on.
 */
export async function getCompanyInvoiceTransportId(companyId: string): Promise<string | null> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { invoiceTransportId: true },
  });
  return company?.invoiceTransportId || null;
}
