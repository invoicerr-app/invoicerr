/**
 * The only aggregator - adding an operator means adding `data/<id>.json` and NOTHING else, the same
 * discovery discipline `channel-policy/data/all.ts` and `b2g-routing/data/all.ts` already hold, keyed
 * on operator id instead of country code (see `../schema.ts`'s own header on why).
 *
 * `discoverOperatorIds()` reads this directory with `readdirSync` and keeps only names matching
 * `/^[a-z0-9-]+\.json$/` - lowercase, kebab-case, `.json`, which excludes this `all.ts` (not `.json`)
 * and nothing else. `readdirSync` makes no ordering promise, so ids are sorted before loading  -
 * deterministic, reproducible, independent of the OS or filesystem.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertValidOperatorFact, OperatorFact } from '../schema';
import { byCodeUnit } from '@/lib/compare';

const OPERATOR_FILE_PATTERN = /^[a-z0-9-]+\.json$/;

/** Every operator id with a `data/<id>.json` file next to this loader, sorted for a deterministic
 *  load order - see the module docstring for why this reads the directory instead of a fixed list. */
function discoverOperatorIds(): string[] {
  return readdirSync(__dirname)
    .filter((name) => OPERATOR_FILE_PATTERN.test(name))
    .map((name) => name.slice(0, -'.json'.length))
    .sort(byCodeUnit);
}

function loadOperatorFile(id: string): OperatorFact {
  const path = join(__dirname, `${id}.json`);
  const raw = readFileSync(path, 'utf-8');
  const parsed = JSON.parse(raw) as OperatorFact;
  if (parsed.id !== id) {
    throw new Error(`documents/operators/data/${id}.json declares id "${parsed.id}", expected "${id}"`);
  }
  assertValidOperatorFact(parsed, `documents/operators/data/${id}.json`);
  return parsed;
}

/** Every operator this catalogue knows about, one file per operator - see the module docstring. */
export const ALL_OPERATOR_FILES: OperatorFact[] = discoverOperatorIds().map(loadOperatorFile);
