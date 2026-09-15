/**
 * The real, cascading deletion `billing-lifecycle-sweep-runner.ts` runs once a `ZIPPED`
 * subscription's own grace period elapses (`lifecycle.ts`'s `delete_company` action) — the terminal
 * step of both cycles that file's own header describes.
 *
 * Almost every relation onto `Company` in `schema.prisma` is `onDelete: Cascade` (verified directly:
 * of the 32 `<field> Company @relation(...)` lines in the schema, 31 carry it), so
 * `prisma.company.delete` alone already removes the company's clients, documents, invitations,
 * channel configs… and its own `CompanySubscription` row — which is exactly why `lifecycle.ts`'s own
 * header notes that no row is ever actually read back with `status: 'DELETED'`: the row disappears in
 * the same statement that would have written it.
 *
 * `Webhook.company` is the ONE exception (`model Webhook`, schema.prisma): its relation carries no
 * `onDelete` clause at all, so Postgres's default (`NO ACTION`) would make `company.delete` fail
 * outright with a foreign-key violation for any company that ever configured a webhook. Rather than
 * touch that unrelated model's own migration history for this feature, this function deletes that
 * ONE leftover table explicitly, in the same transaction, strictly BEFORE the company row itself —
 * literally "ordre des FK" for the single case where the schema does not already give it for free.
 *
 * Deliberately does NOT touch `User` rows: a user can belong to other companies, and even one whose
 * last membership was this company is a login/identity the product brief never asked this feature to
 * remove — only the SOCIÉTÉ and everything scoped to it.
 */
import prisma from '@/prisma/prisma.service';

export async function deleteCompanyPermanently(companyId: string): Promise<void> {
  await prisma.$transaction([
    prisma.webhook.deleteMany({ where: { companyId } }),
    prisma.company.delete({ where: { id: companyId } }),
  ]);
}
