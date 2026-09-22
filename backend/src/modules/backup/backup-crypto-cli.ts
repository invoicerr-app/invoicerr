#!/usr/bin/env -S npx tsx
/**
 * Standalone CLI over `backup-crypto.ts` — usable with NOTHING but Node, this one file, and
 * `BACKUP_ENCRYPTION_KEY`. That is the whole point: this is both the restore path this module
 * documents (see `documentation/docs/user-guide/backups.md`'s "Restoring" section) and the fix for
 * this repository's OTHER unencrypted backup surface — the hand-run `pg_dump | gzip` procedure an
 * operator runs directly on their own machine, entirely outside this application's process. Neither
 * scenario has a running NestJS app, a database connection, or this module's own DI graph available
 * — this file imports nothing from `@nestjs/*`, Prisma, or anywhere else in this module besides
 * `backup-crypto.ts` itself (which is itself dependency-free, `node:crypto`/`node:stream` only), on
 * purpose, so it keeps working when everything else about the instance that produced the backup is
 * gone.
 *
 * Usage (reads stdin, writes stdout — pipe it like any Unix filter):
 *   BACKUP_ENCRYPTION_KEY=... npx tsx src/modules/backup/backup-crypto-cli.ts encrypt < plain > artifact.enc
 *   BACKUP_ENCRYPTION_KEY=... npx tsx src/modules/backup/backup-crypto-cli.ts decrypt < artifact.enc > plain
 *
 * For the manual database dump: compress BEFORE encrypting, never after — ciphertext is
 * indistinguishable from random noise and does not compress:
 *   pg_dump "$DATABASE_URL" | gzip | npx tsx .../backup-crypto-cli.ts encrypt > db-YYYY-MM-DD.sql.gz.enc
 * Restoring:
 *   npx tsx .../backup-crypto-cli.ts decrypt < db-YYYY-MM-DD.sql.gz.enc | gunzip | psql "$DATABASE_URL"
 */
import { pipeline } from 'node:stream/promises';

import { createBackupDecryptStream, createBackupEncryptStream } from './backup-crypto';

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode !== 'encrypt' && mode !== 'decrypt') {
    process.stderr.write(
      'usage: backup-crypto-cli.ts <encrypt|decrypt>   (reads stdin, writes stdout, needs BACKUP_ENCRYPTION_KEY)\n',
    );
    process.exitCode = 2;
    return;
  }

  // Both throw synchronously here — before stdin is even read — if BACKUP_ENCRYPTION_KEY is missing
  // or malformed, per `backup-crypto.ts`'s own "fail loud, never silently pass data through" rule.
  const transform = mode === 'encrypt' ? createBackupEncryptStream() : createBackupDecryptStream();
  await pipeline(process.stdin, transform, process.stdout);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
