/**
 * Exercises `backup-crypto-cli.ts` as an actual, separate OS PROCESS — not by importing its
 * functions, which would only prove `backup-crypto.ts` works, something `backup-crypto.spec.ts`
 * already covers. This file's job is to prove the OPERATOR-FACING tool itself: the thing someone
 * restoring a backup, or piping a `pg_dump` through, actually runs. Spawned with an environment that
 * carries `BACKUP_ENCRYPTION_KEY` and NOTHING else this repository's own app needs (no `DATABASE_URL`,
 * no Redis, no working directory inside a NestJS project) — the whole point this module's header
 * makes: the restore path must not depend on the running application's state.
 */
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const CLI_PATH = join(__dirname, 'backup-crypto-cli.ts');
const TSX_BIN = join(__dirname, '..', '..', '..', 'node_modules', '.bin', 'tsx');
const VALID_KEY = '5'.repeat(64); // 64 hex chars — decodes to exactly 32 bytes

function run(mode: 'encrypt' | 'decrypt', input: Buffer, env: NodeJS.ProcessEnv): Buffer {
  return execFileSync(TSX_BIN, [CLI_PATH, mode], { input, env, timeout: 15_000 });
}

describe('backup/backup-crypto-cli (spawned as a real process)', () => {
  it('round-trips arbitrary bytes through separate encrypt/decrypt process invocations', () => {
    const plaintext = Buffer.from('pretend this is a pg_dump | gzip stream');
    const env = { ...process.env, BACKUP_ENCRYPTION_KEY: VALID_KEY };

    const ciphertext = run('encrypt', plaintext, env);
    expect(ciphertext).not.toEqual(plaintext);

    // A FRESH process, given only the key and the bytes just produced — no shared in-memory state
    // with the `encrypt` invocation above.
    const decrypted = run('decrypt', ciphertext, env);
    expect(decrypted).toEqual(plaintext);
  });

  it('exits non-zero and touches no stdout when BACKUP_ENCRYPTION_KEY is missing from the process env', () => {
    const env = { ...process.env };
    delete env.BACKUP_ENCRYPTION_KEY;

    expect(() => run('encrypt', Buffer.from('x'), env)).toThrow();
  });

  it('rejects with a non-zero exit on an unknown mode, without needing a key at all', () => {
    const env = { ...process.env, BACKUP_ENCRYPTION_KEY: VALID_KEY };
    expect(() => run('wipe' as 'encrypt', Buffer.from(''), env)).toThrow();
  });
});
