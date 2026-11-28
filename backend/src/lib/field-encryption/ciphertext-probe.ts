import prisma from '@/prisma/prisma.service';

import { ciphertextCountSql, type EncryptedColumn } from './boot';

/** Counts stored field ciphertext in the given columns. */
export async function countStoredCiphertext(columns: readonly EncryptedColumn[]): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ count: number }[]>(ciphertextCountSql(columns));
  return rows.reduce((sum, row) => sum + Number(row.count), 0);
}
