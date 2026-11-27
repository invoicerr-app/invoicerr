import { readFileSync } from 'fs';
import { join } from 'path';

// The schema is converged by syncDatabaseSchema() alone: a `db push` in the entrypoint runs on every
// restart and silently reverts migrations that `_prisma_migrations` still records as applied.
describe('entrypoint.sh', () => {
  it('never pushes a Prisma schema itself', () => {
    const script = readFileSync(join(__dirname, '..', '..', '..', 'entrypoint.sh'), 'utf8');
    const commands = script.split('\n').filter((line) => !line.trim().startsWith('#'));

    expect(commands.filter((line) => /\bprisma\b.*\bdb\s+push\b/.test(line))).toEqual([]);
    expect(commands.filter((line) => /\bprisma\b.*\bmigrate\b/.test(line))).toEqual([]);
  });
});
