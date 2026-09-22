import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { INSTANCE_RESET_TABLES } from './reset-tables';

/**
 * Parses `schema.prisma` itself for every `model <Name> { ... }` block and the table name it
 * actually maps to (`@@map("...")` inside the block, or the model name verbatim when absent) — the
 * SAME resolution Prisma's own migration engine applies. This is what keeps `INSTANCE_RESET_TABLES`
 * honest as new models get added over time: a model this list forgets fails THIS test, rather than
 * silently surviving every "reset the instance" call forever.
 */
function tablesDeclaredInSchema(): string[] {
  const schema = readFileSync(join(__dirname, '../../../prisma/schema.prisma'), 'utf8');
  const tables: string[] = [];
  const modelPattern = /^model\s+(\w+)\s*\{/gm;
  for (let match = modelPattern.exec(schema); match !== null; match = modelPattern.exec(schema)) {
    const bodyStart = match.index + match[0].length;
    const bodyEnd = schema.indexOf('\n}', bodyStart);
    const body = schema.slice(bodyStart, bodyEnd === -1 ? undefined : bodyEnd);
    const mapMatch = /@@map\("([^"]+)"\)/.exec(body);
    tables.push(mapMatch ? mapMatch[1] : match[1]);
  }
  return tables;
}

describe('INSTANCE_RESET_TABLES', () => {
  it('never includes _prisma_migrations — the one table an instance reset must never truncate', () => {
    expect(INSTANCE_RESET_TABLES).not.toContain('_prisma_migrations');
  });

  it('has no duplicate entries', () => {
    expect(new Set(INSTANCE_RESET_TABLES).size).toBe(INSTANCE_RESET_TABLES.length);
  });

  it('names every table schema.prisma currently declares — nothing left out', () => {
    const declared = tablesDeclaredInSchema();
    const missing = declared.filter((table) => !INSTANCE_RESET_TABLES.includes(table));
    expect(missing).toEqual([]);
  });

  it("names no table schema.prisma does NOT declare — nothing stale/typo'd", () => {
    const declared = new Set(tablesDeclaredInSchema());
    const stale = INSTANCE_RESET_TABLES.filter((table) => !declared.has(table));
    expect(stale).toEqual([]);
  });
});
