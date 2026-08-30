import 'dotenv/config';

import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    // Runs automatically after `prisma migrate dev` / `migrate reset`, and on demand via
    // `prisma db seed` — Prisma's own seed hook, not a bespoke entry point. Seeds the document
    // country-action policy (backend/src/modules/documents/country-policy/); see prisma/seed.ts.
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
