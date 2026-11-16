/**
 * `npm run billing:grant-founder -- <companyId>` (#760): gives one company the founder price grid
 * (`src/modules/billing/founder-grid.ts`). Run through `tsx`, in development and in the Docker image
 * alike (which ships `backend/scripts`, see the Dockerfile).
 *
 * The grid is kept for as long as the company renews without interruption; once lost it cannot be
 * granted again by this command. Exits non-zero when nothing was granted.
 */
import 'dotenv/config';

import { grantFounderGrid } from '../src/modules/billing/founder-grid';
import prisma from '../src/prisma/prisma.service';

const MESSAGES = {
  granted: 'Founder grid granted.',
  already_held: 'This company already holds the founder grid.',
  lost: 'This company lost the founder grid after an interruption; it cannot be granted again.',
  no_company: 'No company with this id.',
} as const;

async function main(): Promise<number> {
  const companyId = (process.argv[2] ?? '').trim();
  if (companyId === '') {
    console.error('Usage: npm run billing:grant-founder -- <companyId>');
    return 2;
  }
  const outcome = await grantFounderGrid(companyId);
  const log = outcome === 'granted' || outcome === 'already_held' ? console.log : console.error;
  log(MESSAGES[outcome]);
  return outcome === 'granted' || outcome === 'already_held' ? 0 : 1;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
