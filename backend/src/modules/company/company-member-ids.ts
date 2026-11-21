import { Prisma } from '../../../prisma/generated/prisma/client';

export async function companyMemberIds(db: Prisma.TransactionClient, companyId: string): Promise<string[]> {
  const members = await db.userCompany.findMany({ where: { companyId }, select: { userId: true } });
  return members.map((member) => member.userId);
}
